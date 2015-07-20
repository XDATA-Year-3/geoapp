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
import json
import os
import psycopg2
import sys
import time
kafka = None

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(os.path.realpath(
    __file__)), '../server')))
from geoapp import insertItemIntoPostgres


def ingestES(es, pg, poll=10, batch=100, skipEpoch=None, maxEpoch=None,
             nodup=True, **kwargs):
    """
    Ingest from Elasticsearch to Postgres.

    :param es: elasticsearch connection information.
    :param pg: postgres connection information.
    :param poll: elasticsearch poll interval in seconds.
    :param batch: maximum number of records to get from elasticsearch at once.
    :param skipEpoch: if present, skip all elasticsearch items with
                      created_time epochs less than or equal to this value.
    :param maxEpoch: if present, skip all elasticsearch items with
                     created_time epochs greater than or equal to this value.
                     Also, add items in descending order.
    :param nodup: if True, check for duplicates and make some effort to avoid
                  them.
    """
    starttime = time.time()
    if not es.startswith('https://'):
        es = 'http://' + es
    es = es.rstrip('/') + '/_search'
    pdb = psycopg2.connect(dsn=pg)
    pcursor = pdb.cursor()
    if skipEpoch:
        skipEpoch = int(float(skipEpoch) * 1000)
    else:
        skipEpoch = 0
    if maxEpoch:
        skipEpoch = int(float(maxEpoch) * 1000)
    nextEpoch = skipEpoch
    ingested = processed = 0
    firstPass = True
    while True:
        try:
            # curl -XPOST "http://10.1.94.103:9200/instagram_remap/_search?
            # pretty" -d '{size:1,from:0,sort:{created_time:{order:"asc"}},
            # query:{filtered:{filter:{exists: {field: "longitude"}},
            # query:{range:{created_time:{gte:1437161193000}}} }}}'
            query = {
                'size': batch,
                'from': processed,
                'sort': {'created_time': {'order':
                    'asc' if not maxEpoch else 'desc'
                }},
                'query': {
                    'filtered': {
                        'filter': {'exists': {'field': 'longitude'}},
                        'query': {
                            'range': {'created_time':
                                {'gte': skipEpoch} if not maxEpoch else
                                {'lte': skipEpoch}
                            }
                        }
                    }
                }
            }
            cmd = 'curl -XPOS \'%s\' -d \'%s\'' % (
                es.replace("'", "'\\''"),
                json.dumps(query).replace("'", "'\\''"))
            try:
                results = json.loads(os.popen(cmd + ' -s').read())
            except ValueError:
                print 'Decoding error.  Waiting a while and trying again.'
                time.sleep(300)
                continue
            if firstPass:
                print '%d to ingest' % results['hits']['total']
                firstPass = False
            results = results['hits']['hits']
            oldProcessed = processed
            oldIngested = ingested
            for row in results:
                processed += 1
                item = convertInstagramJSONToItem(row['_source'])
                if item is None:
                    continue
                if insertItemIntoPostgres(pdb, pcursor, item, nodup):
                    ingested += 1
                nextEpoch = str(int(row['_source']['created_time']) + (
                    - 1 if not maxEpoch else 1))
            if (len(results) < batch and
                    processed - ingested > oldProcessed - oldIngested):
                processed = max(0, processed - 1000)
            if oldProcessed == processed:
                time.sleep(poll)
                continue
            rate = ingested / (time.time() - starttime)
            print('Ingest %d, skip %d, epoch %s %s, %4.2f msg/s' % (
                ingested, processed - ingested, nextEpoch,
                time.strftime('%y-%m-%d %H:%M:%S', time.gmtime(float(
                nextEpoch))), rate))
        except KeyboardInterrupt:
            print 'User cancelled'
            rate = ingested / (time.time() - starttime)
            print('Ingest %d, skip %d, epoch %s %s, %4.2f msg/s' % (
                ingested, processed - ingested, nextEpoch,
                time.strftime('%y-%m-%d %H:%M:%S', time.gmtime(float(
                nextEpoch))), rate))
            return


def ingestKafka(kafkaInfo, pg, nodup=True, **kwargs):
    """
    Ingest from Elasticsearch to Postgres.

    :param kafkaInfo: kafka connection information.
    :param pg: postgres connection information.
    :param nodup: if True, check for duplicates and make some effort to avoid
                  them.
    """
    global kafka
    if kafka is None:
        import kafka
    starttime = time.time()
    laststatus = 0
    broker, topics = kafkaInfo.split('/', 1)
    if not ':' in broker:
        broker += ':9092'
    topics = topics.split(',')
    consumer = kafka.KafkaConsumer(*topics, bootstrap_servers=[broker],
                                   auto_offset_reset='smallest')
    pdb = psycopg2.connect(dsn=pg)
    pcursor = pdb.cursor()
    ingested = processed = 0
    for message in consumer:
        try:
            results = json.loads(message.value)
            for row in results:
                processed += 1
                item = convertInstagramJSONToItem(row)
                if item is None:
                    continue
                if insertItemIntoPostgres(pdb, pcursor, item, nodup):
                    ingested += 1
                nextEpoch = str(int(row['created_time']) - 1)
            curtime = time.time()
            rate = ingested / (curtime - starttime)
            if curtime - laststatus > 1:
                laststatus = curtime
                print('Ingest %d, skip %d, epoch %s %s, %4.2f msg/s' % (
                    ingested, processed - ingested, nextEpoch,
                    time.strftime('%y-%m-%d %H:%M:%S', time.gmtime(float(
                    nextEpoch))), rate))
        except KeyboardInterrupt:
            print 'User cancelled'
            rate = ingested / (time.time() - starttime)
            print('Ingest %d, skip %d, epoch %s %s, %4.2f msg/s' % (
                ingested, processed - ingested, nextEpoch,
                time.strftime('%y-%m-%d %H:%M:%S', time.gmtime(float(
                nextEpoch))), rate))
            return


def convertInstagramJSONToItem(inst):
    """
    Convert an instagram JSON object to our item format.

    :param inst: the instagram item.
    :return: an item or None.
    """
    if (not inst.get('location', None) or
            'latitude' not in inst['location'] or
            'longitude' not in inst['location']):
        return None
    item = {
        'user_name':     inst['user']['username'],
        'user_fullname': inst['user']['full_name'],
        'user_id':       inst['user']['id'],
        'posted_date':   inst['created_time'],
        'url':           inst['link'],
        'latitude':      inst['location']['latitude'],
        'longitude':     inst['location']['longitude'],
        'comment_count': inst['comments']['count'],
        'comments':      '',
        'like_count':    inst['likes']['count'],
        'likes':         '',
        'scraped_date':  int(inst['created_time']),
    }
    if inst['caption']:
        item['caption'] = inst['caption']['text']
        item['scraped_date'] = max(item['scraped_date'],
                                   int(inst['caption'].get('created_time', 0)))
    if 'data' in inst['comments']:
        for comm in inst['comments']['data']:
            item['scraped_date'] = max(
                item['scraped_date'],
                int(comm.get('created_time', 0)))
    if 'id' in inst['location']:
        item['location_id'] = inst['location']['id']
    if 'name' in inst['location']:
        item['location_name'] = inst['location']['name']
    if 'data' in inst['comments']:
        item['comments'] = '|'.join(['%s;%s;%s;%s' % (
            comm['from']['username'], comm['from']['id'],
            comm['created_time'], comm['text'].replace('|', ' ')
        ) for comm in inst['comments']['data']])
    if 'data' in inst['likes']:
        item['likes'] = '|'.join(['%s;%s' % (
            like['username'], like['id']
        ) for like in inst['likes']['data']])
    item['msg_id'] = item['url'].strip('/').rsplit('/', 1)[-1]
    item['url'] = 'i/%s' % (item['msg_id'])

    item['msg_date'] = int(item['posted_date'])
    item['msg_date_ms'] = int(float(item['posted_date']) * 1000)
    if 'caption' in item:
        item['msg'] = item['caption']
    item['ingest_date'] = int(time.time())
    item['ingest_source'] = 'elasticsearch'
    item['service'] = 'i'
    return item


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Load data from elasticsearch to our postgres format.')
    parser.add_argument(
        '--es', help='The elasticsearch database and collection.  For example '
        '10.1.94.103:9200/instagram_remap',
        default='10.1.94.103:9200/instagram_remap')
    parser.add_argument(
        '--kafka', help='The kafka broker and topic(s).  If specified, kafka '
        'is used instead of elasticsearch.  The topics can be comma '
        'separated.  For example memex-kafka01:9092/instagram',
        dest='kafkaInfo')
    parser.add_argument(
        '--pg', help='Our postgres database location.  For example, '
        '\'dbname=rtmsg user=taxi password=taxi#1 host=parakon port=5432\'.  '
        'We always use the table named \'messages\'.',
        default='dbname=rtmsg2 user=taxi password=taxi#1 port=5432')
    parser.add_argument(
        '--epoch', help='Load only data from the elasticsearch database that '
        'are later than the specified epoch.', dest='skipEpoch')
    parser.add_argument(
        '--maxepoch', help='Load only data from the elasticsearch database '
        'that are earlier than the specified epoch.', dest='maxEpoch')
    parser.add_argument(
        '--poll', help='How often to poll for new data in seconds.',
        type=float, default=10)
    parser.add_argument(
        '--batch', help='The maximum number of records to get from '
        'elasticsearch at atime.', type=int, default=100)
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
    if args.get('kafkaInfo', None):
        ingestKafka(**args)
    else:
        ingestES(**args)
