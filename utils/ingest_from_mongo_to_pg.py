#!/usr/bin/env python
# -*- coding: utf-8 -*-

###############################################################################
#  Copyright 2015 Kitware Inc.
#
#  Licensed under the Apache License, Version 2.0 ( the "License" );
#  you may not use this file except in compliance with the License.
#  You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.
###############################################################################

import argparse
import calendar
import dateutil.parser
import os
import psycopg2
import pymongo
import sys
import time
from bson.objectid import ObjectId

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(os.path.realpath(
    __file__)), '../server')))
from geoapp import insertItemIntoPostgres


def ingest(mongo, mongoCollection, pg, poll=10, batch=100, skipId=None,
           nodup=True):
    """
    Ingest from Mongo to Postgres.

    :param mongo: mongo connection information.
    :param mongoCollection: mongo collection name.
    :param pg: postgres connection information.
    :param poll: mongo poll interval in seconds.
    :param batch: maximum number of records to get from mongo at once.
    :param skipId: if present, skip all mongo ObjectIds less than or equal to
                   this value.
    :param nodup: if True, check for duplicates and make some effort to avoid
                  them.
    """
    starttime = time.time()
    if not mongo.startswith('mongodb://'):
        mongo = 'mongodb://' + mongo
    mongoClientOptions = {'connectTimeoutMS': 15000}
    mconn = pymongo.MongoClient(mongo, **mongoClientOptions)
    mdb = mconn.get_default_database()
    mcoll = mdb[mongoCollection]
    pdb = psycopg2.connect(dsn=pg)
    pcursor = pdb.cursor()
    if skipId:
        skipId = ObjectId(skipId)
    ingested = processed = 0
    firstPass = True
    while True:
        try:
            query = {'geo': {'$exists': True}}
            if skipId:
                query['_id'] = {'$gt': skipId}
            mcursor = mcoll.find(spec=query, limit=batch, sort=[('_id', 1)],
                                 timeout=False)
            if firstPass:
                numrows = mcursor.count()
                print('%d to ingest' % numrows)
                firstPass = False
            oldProcessed = processed
            for row in mcursor:
                processed += 1
                item = convertGnipToItem(row)
                if item is None:
                    continue
                if insertItemIntoPostgres(pdb, pcursor, item, nodup):
                    ingested += 1
                skipId = row['_id']
            if oldProcessed == processed:
                time.sleep(poll)
                continue
            rate = ingested / (time.time() - starttime)
            print('Ingested %d, skipped %d, last oid %s, %5.3f msg/s' % (
                ingested, processed - ingested, skipId, rate))
        except KeyboardInterrupt:
            print 'User cancelled'
            rate = ingested / (time.time() - starttime)
            print('Ingested %d, skipped %d, last oid %s, %5.3f msg/s' % (
                ingested, processed - ingested, skipId, rate))
            return


def convertGnipToItem(gnip):
    """
    Convert a GNIP object into our item format.

    :param gnip: the gnip object to convert.
    :return: the converted item or None for failure.
    """
    if gnip['verb'] != 'post':
        return None
    date = int(calendar.timegm(dateutil.parser.parse(
               gnip['postedTime']).utctimetuple()) * 1000)
    if '.' in gnip['postedTime']:
        try:
            date += float('.' + gnip['postedTime'].split('.')[1].split('Z')[0])
        except ValueError:
            pass
    item = {
        'msg_id': gnip['object']['id'].split(':')[-1],
        'user_id': gnip['actor']['id'].split(':')[-1],
        'user_name': gnip['actor']['preferredUsername'],
        'msg_date': int(date / 1000),
        'msg_date_ms': date,
        'msg': gnip['body'],
        'utc_offset': gnip['actor'].get('utcOffset', None),
        'ingest_date': time.time()
    }
    item['url'] = 't/%s/%s' % (item['user_id'], item['msg_id'])
    if ('twitter_entities' in gnip and 'media' in gnip['twitter_entities'] and
            len(gnip['twitter_entities']['media']) > 0 and
            'media_url_https' in gnip['twitter_entities']['media'][0]):
        item['image_url'] = gnip['twitter_entities']['media'][0][
            'media_url_https']
    if ('geo' in gnip and gnip['geo'] and 'coordinates' in gnip['geo'] and
            len(gnip['geo']['coordinates']) >= 2):
        # gnip using latitude, longitude for geo (but twitter used long, lat
        # for coordinates)
        item['latitude'] = gnip['geo']['coordinates'][0]
        item['longitude'] = gnip['geo']['coordinates'][1]
    if 'location' in gnip and gnip['location']['name']:
        item['location_id'] = gnip['location']['link'].split('/')[-1].split(
            '.')[0]
        item['location_name'] = gnip['location']['name']
    elif 'latitude' not in item:
        # Don't allow location-less data
        return None
    if 'Instagram' in gnip['generator'].get('link', ''):
        import pprint  # ##DWM::
        pprint.pprint(gnip)
    item['ingest_source'] = 'gnip'
    return item


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Load data from a gnip mongo db to our postgres format.')
    parser.add_argument(
        '--mongo', help='The mongo database and default collection.  For '
        'example, xd-mongo.xdata.data-tactics-corp.com:27017/ist-qcr or '
        '10.1.92.124/ist-qcr.',
        default='10.1.92.124/ist-qcr')
    parser.add_argument(
        '--coll', '--collection', help='Mongo collection name.  For example, '
        'gnip_tweets_full.', default='gnip_tweets_full',
        dest='mongoCollection')
    parser.add_argument(
        '--pg', help='Our postgres database location.  For example, '
        '\'dbname=rtmsg user=taxi password=taxi#1 host=parakon port=5432\'.  '
        'We always use the table named \'messages\'.', default='dbname=rtmsg '
        'user=taxi password=taxi#1 host=10.0.2.2 port=5432')
    parser.add_argument(
        '--id', help='Load only data from the mongo database that are greater '
        'than the specified Object ID.', dest='skipId')
    parser.add_argument(
        '--poll', help='How often to poll for new data in seconds.',
        type=float, default=10)
    parser.add_argument(
        '--batch', help='The maximum number of records to get from mongo at a'
        'time.', type=int, default=100)
    parser.add_argument(
        '--nodup', help='Check to make sure that an item is not already in '
        'the postgres database before inserting it.  This doesn\'t guarantee '
        'no duplicates in the database because a second thread could add one '
        'at the same time.', action='store_true')
    parser.add_argument(
        '--dup', help='Skip duplicate checks.  This is faster, but duplicates '
        'are allowed', dest='nodup', action='store_false')
    parser.set_defaults(nodup=True)
    args = vars(parser.parse_args())
    ingest(**args)
