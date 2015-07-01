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

import bz2
import calendar
import csv
import datetime
import dateutil.parser
import glob
import gzip
import HTMLParser
import json
import math
import os
import pprint
import random
import re
import sys
import tempfile
import time
import xml.sax.saxutils
import zipfile

import fileutil


KeyList = [
    'user_name', 'user_id', 'posted_date', 'url', 'image_url', 'caption',
    'latitude', 'longitude', 'location_id', 'location_name',
    'comment_count', 'like_count'  # , 'comments', 'likes', 'scraped_date'
]
MessageKeyList = [
    'user_name', 'user_id', 'msg_date', 'url', 'image_url', 'msg',
    'latitude', 'longitude', 'location_id', 'location_name',

    'source', 'msg_date_ms', 'utc_offset', 'ingest_date', 'ingest_source',
    'user_fullname', 'region', 'service',
]
JSONKeyList = [
    'user_name', 'user_id', 'msg_date', 'url', 'image_url', 'msg',
    'latitude', 'longitude', 'location_id', 'location_name',

    'user_fullname', 'region', 'service',
    'comment_count', 'like_count', 'favorites_count', 'followers_count',
    'friends_count', 'statuses_count',
]
TwitterMentionPattern = re.compile('@[a-zA-Z0-9_]{1,15}')
InstagramMentionPattern = re.compile(
    '@[a-zA-Z0-9_][a-zA-Z0-9_.]{0,28}[a-zA-Z0-9_]?')
IngestTime = time.time()


def adjustItemForStorage(item, format=None, ingestSource=None, service=None,
                         region=None):
    """
    Adjust an item to store it the way we want to based on the format and
    other restrictions.

    :param item: item to modify
    :param format: if 'message', copy various data to additional keys.
    :param ingestSource: text to add as the way this was ingested.
    :param service: the base service ('t' for twitter or 'i' for instagram)
    :param region: a region to associate with the item.
    """
    if item['url'].startswith('http://instagram.com/p/'):
        item['url'] = (
            'i/' + item['url'].split('http://instagram.com/p/', 1)[1])
    if format == 'message' or format == 'json':
        item['msg_date'] = int(item['posted_date'])
        item['msg_date_ms'] = int(float(item['posted_date']) * 1000)
        if 'caption' in item:
            item['msg'] = item['caption']
        item['ingest_date'] = int(item.get('scraped_date', IngestTime))
        item['ingest_source'] = ingestSource
        item['service'] = service
        item['region'] = region


def convertGnipToTwitterItem(gnip):
    """
    Convert a GNIP object into our item format.

    :param gnip: the gnip object to convert.
    :return: the converted item or None for failure.
    """
    if (gnip.get('verb', None) != 'post' or 'actor' not in gnip or
            not gnip['actor'].get('preferredUsername', None) or
            'object' not in gnip or 'id' not in gnip['object']):
        return None
    try:
        date = int(calendar.timegm(dateutil.parser.parse(
                   gnip['postedTime']).utctimetuple()) * 1000)
    except ValueError:
        return None
    if '.' in gnip['postedTime']:
        try:
            date += float('.' + gnip['postedTime'].split('.')[1].split('Z')[0])
        except ValueError:
            pass
    item = {
        'msg_id': gnip['object']['id'].split(':')[-1],
        'user_id': gnip['actor']['id'].split(':')[-1],
        'user_name': gnip['actor']['preferredUsername'],
        'user_fullname': gnip['actor'].get('displayName', None),
        'posted_date': float(date / 1000),
        'caption': xml.sax.saxutils.unescape(gnip['body']),
        'utc_offset': gnip['actor'].get('utcOffset', None),
        'ingest_date': IngestTime,
    }
    for actkey, itemkey in [
            ('favoritesCount', 'favorites_count'),
            ('followersCount', 'followers_count'),
            ('friendsCount', 'friends_count'),
            ('statusesCount', 'statuses_count')]:
        if actkey in gnip['actor']:
            item[itemkey] = gnip['actor'][actkey]
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
    if ('instagram' in gnip['generator'].get('link', '') and 'gnip' in gnip and
            'urls' in gnip['gnip'] and len(gnip['gnip']['urls']) and
            'expanded_url' in gnip['gnip']['urls'][0] and
            'instagram.com/p/' in gnip['gnip']['urls'][0]['expanded_url']):
        item['hash'] = gnip['gnip']['urls'][0]['expanded_url'].strip(
            '/').split('/')[-1]
        item['source'] = gnip['gnip']['urls'][0]['expanded_url']
    return item


def convertInstagramJSONToItem(inst, partial):
    """
    Convert an instagram JSON object to our item format.

    :param inst: the instagram item.
    :param partial: if True, partial data is allowed.
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
    if not partial:
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
    return item


def convertTwitterJSONToItem(tw, decoder, line, partial):
    """
    Convert a twitter JSON object to our item format.

    :param tw: the twitter object to convert.
    :param decoder: an HTMLParser decoder
    :param line: the original undecode line of json.
    :param partial: if True, partial data is allowed.
    :return: the converted item or None for failure.
    """
    if 'created_at' not in tw:
        return None
    date = int(calendar.timegm(dateutil.parser.parse(
        tw['created_at']).utctimetuple()))
    item = {
        'user_name':       tw['user']['screen_name'],
        'user_fullname':   tw['user']['name'],
        'user_id':         tw['user']['id_str'],
        'posted_date':     date,
        'caption':         decoder.unescape(tw['text']),
        'url':             't/' + tw['user']['id_str'] + '/' + tw['id_str'],
        # 'comment_count': inst['comments']['count'],
        # 'comments':      '',
        'like_count':      tw.get('retweet_count', None),
        'favorites_count': tw.get('favourites_count', None),
        'followers_count': tw.get('followers_count', None),
        'friends_count':   tw.get('friends_count', None),
        'statuses_count':  tw.get('statuses_count', None),
        # 'likes':         '',
        'latitude':        tw['coordinates']['coordinates'][1],
        'longitude':       tw['coordinates']['coordinates'][0],
        'scraped_date':    date
    }
    if 'instagr.am\\/p\\/' in line:
        item['hash'] = line.split('instagr.am\\/p\\/', 1)[1].split(
            '\\/', 1)[0]
    if ('source' in tw and 'Instagram' in tw['source'] and
            'entities' in tw and 'urls' in tw['entities'] and
            len(tw['entities']['urls']) >= 1 and
            'display_url' in tw['entities']['urls'][0] and
            'instagram' in tw['entities']['urls'][0]['display_url']):
        item['source'] = tw['entities']['urls'][0]['display_url']
    item['utc_offset'] = tw['user']['utc_offset']
    if not partial:
        if ('entities' in tw and 'media' in tw['entities'] and
                len(tw['entities']['media']) > 0 and
                'media_url_https' in tw['entities']['media'][0]):
            item['image_url'] = tw['entities']['media'][0][
                'media_url_https']
        if tw.get('place', None) and 'id' in tw['place']:
            item['location_id'] = tw['place']['id']
        if tw.get('place', None) and 'name' in tw['place']:
            item['location_name'] = tw['place']['name']
    return item


def csvToItems(fptr, partial=False):
    """
    Given a file-like object containing a csv file, read a header line then
    return each subsequent line as a dictionary based on the header data.  The
    line must contain a posted_date value in an expected format.

    :param fptr: a file-like object with a csv file.
    :param partial: if True, partial data is allowed.
    :yields: items parsed from the file.
    """
    fptr = csv.reader(fptr)
    header = [key.strip() for key in fptr.next()]
    epoch = datetime.datetime.utcfromtimestamp(0)
    for record in fptr:
        item = dict(zip(header, [
            val.strip().decode('utf8') for val in record]))
        for key in ('posted_date', 'scraped_date'):
            try:
                item[key] = int((datetime.datetime.strptime(
                    item[key], '%Y-%m-%dT%H:%M:%S') - epoch
                ).total_seconds())
            except Exception:
                continue
        if 'user_id_num' in item:
            item['user_id'] = str(item['user_id_num'])
        if 'image_url' in item and 'url' not in item:
            item['url'] = item['image_url']
            del item['image_url']
        yield item


def dataToFiles(fileData, row=None):
    """
    Store a row of data in temporary files.  This allows easier shuffling.

    :param fileData: a dictionary of information to track the file usage.  The
                     'numFiles' key should be set to the number of partition
                     files that will be used.
    :param row: if not None, the string to store.
    """
    if 'files' not in fileData:
        numFiles = fileData.get('numFiles', 10)
        files = []
        for f in xrange(numFiles):
            (fd, filename) = tempfile.mkstemp('.tmp')
            os.close(fd)
            fptr = fileutil.OpenWithoutCaching(filename, 'wb')
            files.append({'name': filename, 'fptr': fptr})
        fileData['numFiles'] = numFiles
        fileData['files'] = files
        fileData['numRows'] = 0
    files = fileData['files']
    if row is not None:
        if fileData['numFiles'] > 1:
            fnum = random.randint(0, fileData['numFiles'] - 1)
        else:
            fnum = 0
        files[fnum]['fptr'].write(row.encode('utf8') + '\n')
        fileData['numRows'] += 1


def jsonToItems(fptr, partial=False, firstline=None):
    """
    Given a file-like object containing json, read it in, and parse the
    elements in a structure like {'data': [{'data': [(elements)]}]}.  Return
    each element that has necessary metadata reformated to a standard
    dictionary of values.

    :param fptr: a file-like object with json.
    :param partial: if True, partial data is allowed.
    :param firstline: used to determine if we should read the file line by line
                      or all at once.
    :yields: items parsed from the file.
    """
    byline = (firstline.strip() == '[')
    if not byline:
        records = json.loads(fptr.read())
        if 'data' in records:
            instlist = []
            for record in records['data']:
                instlist.extend(record['data'])
        else:
            instlist = [record['_source'] for record in records]
    else:
        fptr.readline()
        instlist = fptr
    for inst in instlist:
        if byline:
            inst = inst.strip().strip(',]')
            if not inst:
                continue
            inst = json.loads(inst)['_source']
        item = convertInstagramJSONToItem(inst, partial)
        if item is None:
            continue
        yield item


def outputFiles(fileData, dptr, format='instagram'):
    """
    Based on a set of input files, shuffle each in turn and write it out.

    :param fileData: a dictionary of information that tracked file usage.
    :param dptr: the output file-like pointer.
    :param format: either 'message' or 'instagram'.  This affects whether an
                   _id column is added to the data.
    """
    files = fileData['files']
    numRows = fileData['numRows']
    for f in files:
        f['fptr'].close()
    starttime = time.time()
    id = 0
    for f in files:
        data = fileutil.OpenWithoutCaching(
            f['name'], 'rb').read().strip().split('\n')
        os.unlink(f['name'])
        random.shuffle(data)
        for line in data:
            if format == 'instagram':
                dptr.write('%d\t%s\n' % (id, line))
            elif format == 'message':
                dptr.write('%s\n' % (line))
            else:
                dptr.write(',' if id else '[\n')
                dptr.write('%s\n' % (line))
            id += 1
            if not id % 1000:
                elapsed = time.time() - starttime
                if elapsed:
                    left = (numRows - id) * (elapsed / id)
                else:
                    left = 0
                sys.stderr.write('%d/%d %3.1fs  %3.1fs left  \r' % (
                    id, numRows, elapsed, left))
                sys.stderr.flush()
        data = None
    if format == 'json':
        dptr.write(']\n')


def processFiles(files, items, fileData, format='instagram'):
    """
    Process the list of files, either determining the latest entry we have for
    each instagram message or storing the latest entries for final conversion.

    :param files: a list of files to process.
    :param items: a dictionary to track the latest entry for each item.
    :param fileData: a dictionary of information to tracked file usage to store
                     the results, or None to just compute the latest entry.
    :param format: either 'instagram' or 'message'
    :return: the number of items processed (which is usually more than the
             number of items returned).
    """
    processed = 0
    itemsStored = 0
    files_processed = 0
    keylist = (KeyList if format == 'instagram' else
               (JSONKeyList if format == 'json' else MessageKeyList))
    for filerecord in files:
        region = filerecord.get('region', None)
        (fptr, filename) = processFilesOpen(**filerecord)
        if filename.split('.')[-1].lower() == 'csv':
            itemlist = csvToItems(fptr, fileData is None)
            ingestSource = 'instagram_csv'
            service = 'i'
        else:
            line = fptr.readline()
            # Not all formats support seeking back to zero, so just reopen
            (fptr, filename) = processFilesOpen(**filerecord)
            if 'tweet' in line:
                itemlist = twitterToItems(fptr, fileData is None, fileData)
                ingestSource = 'twitter_json'
                service = 't'
            else:
                itemlist = jsonToItems(fptr, fileData is None, line.strip())
                ingestSource = 'instagram_json'
                service = 'i'
        for item in itemlist:
            if not processed % 1000:
                sys.stderr.write('%4d/%4d %9d/%9d\r' % (
                    files_processed + 1, len(files), itemsStored, processed))
                sys.stderr.flush()
            processed += 1
            try:
                # Check that these are reasonable and castable to the
                # expected data type
                lat = float(item['latitude'])
                lon = float(item['longitude'])
                if (not int(item['posted_date']) or not item['url'] or
                        lat < -90 or lat > 90 or lon < -180 or lon > 180):
                    continue
            except Exception:
                continue
            item['url'] = item['url'].rstrip('/')
            scrapedDate = int(item.get('scraped_date', item.get(
                'posted_date', 0)))
            # The same message is repeated often with just different likes or
            # comments.  We keep the keep the latest message based on
            # scraped_date or the latest comment or caption date.
            key = item['url'].rsplit('/', 1)[-1]
            if 'hash' in item:
                # If we have a hash value, use it instead of the key, but
                # treat the data as a later addition.
                key = item['hash']
                scrapedDate -= 365 * 86400
            if fileData is None:
                items[key] = max(items.get(key, 0), scrapedDate)
                itemsStored = len(items)
                continue
            if key not in items or scrapedDate != items[key]:
                continue
            del items[key]
            trackMentions(fileData.get('mentions', None), item, service)
            trackLikes(fileData.get('mentions', None), item,
                       fileData.get('likes', False))
            adjustItemForStorage(item, format, ingestSource, service, region)
            if format == 'json':
                item = json.dumps({jkey: item[jkey] for jkey in keylist
                                   if item.get(jkey, None) is not None})
            else:
                item = [item.get(lkey, None) for lkey in keylist]
                # Escape for Postgres bulk import
                item = ['\\N' if col is None else unicode(col).replace(
                    '\t', ' ').replace('\r', ' ').replace('\n', ' ').replace(
                    '\v', ' ').replace('\f', ' ').replace('\b', ' ').replace(
                    '\\', '\\\\') for col in item]
                item = '\t'.join(item)
            dataToFiles(fileData, item)
            itemsStored += 1
        files_processed += 1
        sys.stderr.write('%4d/%4d %9d %s\n' % (
            files_processed, len(files), itemsStored, filename[-59:]))
    return processed


def processFilesOpen(filename, filetype='file', subname='', zptr=None,
                     **kwargs):
    """
    Open a file for processing.  If it is a compressed file, open for
    decompression.

    :param filetype: 'zip' if this is a zip archive.
    :param filename: name of the file (if a zip archive, this is the archive).
    :param subname: name within an archive.
    :param zptr: a pointer to a zip archive if appropriate.
    :returns: a file-like object and the display filename.
    """
    if filetype == 'zip':
        fptr = zptr.open(subname)
        filename += ' - ' + subname
    elif filename.lower().endswith('.bz2'):
        fptr = bz2.BZ2File(filename)
        filename = filename.rsplit('.', 1)[0]
    elif filename.lower().endswith('.gz'):
        fptr = gzip.open(filename)
        filename = filename.rsplit('.', 1)[0]
    else:
        fptr = open(filename)
    return fptr, filename


def trackLikes(mentions, item, likes=False):
    """
    If we are tracking mentions and likes, parse likes and comments and add
    those users to the user mention dictionaries.

    :param mentions: either a dictionary to store mentions or None to skip the
                     process.
    :param item: an item to parse for mentions.
    :param likes: if True, add likes and comments to the tracking.
    """
    if (mentions is None or not likes or (not item.get('likes', None) and
                                          not item.get('comments', None))):
        return
    users = []
    likes = item.get('likes', None)
    if likes:
        users.extend([like.split(';', 1)[0] for like in likes.split('|')])
    comments = item.get('comments', None)
    if comments:
        users.extend([like.split(';', 1)[0] for like in comments.split('|')])
    if not len(users):
        return
    user = item['user_name'].lower()
    mentions[user] = mentions.get(user, {})
    for mention in users:
        name = mention[1:].lower()
        mentions[user][name] = mentions[user].get(name, 0) + 1


def trackMentions(mentions, item, service):
    """
    If we are tracking mentions, parse a message string for mentions and build
    user mention dictionaries.

    :param mentions: either a dictionary to store mentions or None to skip the
                     process.
    :param item: an item to parse for mentions.
    :param service: either 'i' for instagram or 't' for twitter.
    """
    if (mentions is None or not item.get('caption', None) or
            '@' not in item['caption']):
        return
    if service == 'i':
        users = InstagramMentionPattern.findall(item['caption'])
    else:
        users = TwitterMentionPattern.findall(item['caption'])
    if not len(users):
        return
    user = item['user_name'].lower()
    mentions[user] = mentions.get(user, {})
    for mention in users:
        name = mention[1:].lower()
        mentions[user][name] = mentions[user].get(name, 0) + 1


def twitterToItems(fptr, partial=False, matches=None):
    """
    Given a file-like object containing json, read it in, and parse each line.
    Return each element that has necessary metadata reformated to a standard
    dictionary of values.

    :param fptr: a file-like object with json.
    :param partial: if True, partial data is allowed.
    :param matches: a dictionary to store twitter to instagram correspondence
                    information.
    :yields: items parsed from the file.
    """
    # I probably need to adjust to match the time zone records of other data
    # sources.
    dststart = calendar.timegm(dateutil.parser.parse(
        '2013-03-10 02:00 +0500').utctimetuple())
    dstend = calendar.timegm(dateutil.parser.parse(
        '2013-11-03 02:00 +0500').utctimetuple())

    decoder = HTMLParser.HTMLParser()

    for line in fptr:
        if not len(line.strip()):
            continue
        tw = json.loads(line.strip())
        try:
            if 'gnip' in tw:
                item = convertGnipToTwitterItem(tw)
            else:
                item = convertTwitterJSONToItem(tw, decoder, line, partial)
        except Exception:
            sys.stderr.write(pprint.pformat(tw).strip() + '\n')
            raise
        if item is None:
            continue
        if item.get('hash', None):
            if matches and not partial and 'matches' in matches:
                matches['matches'][item['user_id']] = item['hash']
        date = item['posted_date']
        if date < dststart or date > dstend:
            date -= 18000
        else:
            date -= 14400
        item['posted_date'] = date
        yield item


if __name__ == '__main__':
    if len(sys.argv) < 2 or '--help' in sys.argv:
        print """Load instagram and twitter data files to a Postgres table.

Syntax: messages_to_pg.py [--noclear] [--message|--json] [--match=(file)]
                          [--mentions=(file) [--likes]] (files) > (data.pg)

Files must not start with a dash.  Files can be json or csv, either plain or
stored in zip, bzip2, or gzip files.  Zip, bzip2, and gzip files must end with
.zip, .bz2, and .gz respectively.  In a zip archive, only files within the
compressed file ending with .json or .csv are ingested.
--json outputs json instead of a postgres copy command.
--likes combines likes and comments users into the mentions graph.
--match writes out twitter-to-instagram matches to a separate file.
--mentions parses mentions from messages and builds a user mentions graph.
    The output is a json file.
--message outputs data that can be added to the real-time message table rather
    than to the original instagram message table.  It always implies --noclear.
--noclear doesn't drop or create the postgres table.
"""
        sys.exit()

    format = ('message' if '--message' in sys.argv[1:] else
              ('json' if '--json' in sys.argv[1:] else 'instagram'))
    # Parse input files and store results in temporary files
    fileData = {}
    for arg in sys.argv[1:]:
        if arg.startswith('--match='):
            fileData['matches'] = {}
        elif arg.startswith('--mentions='):
            fileData['mentions'] = {}
            if '--likes' in sys.argv[1:]:
                fileData['likes'] = True
    files = []
    region = None
    for filespec in sys.argv[1:]:
        if filespec.startswith('-'):
            if filespec.startswith('--region='):
                region = filespec.split('=', 1)[1]
            continue
        for filename in glob.iglob(filespec):
            if filename.lower().endswith('.zip'):
                zptr = zipfile.ZipFile(filename)
                files.extend(
                    [{'filetype': 'zip', 'filename': filename,
                      'subname': subname, 'zptr': zptr, 'region': region}
                     for subname in zptr.namelist()
                     if subname.split('.')[-1].lower() in ('json', 'csv')])
            else:
                files.append({'filename': filename, 'region': region})
    items = {}
    processFiles(files, items, None, format)
    lenItems = len(items)
    fileData['numFiles'] = int(math.ceil(float(lenItems + 1) / 500000))
    processed = processFiles(files, items, fileData, format)
    items = None

    # Output the results
    dptr = sys.stdout
    if '--noclear' not in sys.argv[1:] and format == 'instagram':
        dptr.write("""DROP TABLE instagram;

CREATE TABLE instagram (
    user_name text,
    user_id text,
    posted_date int,
    url text,
    image_url text,
    caption text,
    latitude double precision,
    longitude double precision,
    location_id text,
    location_name text,
    comment_count int,
    like_count int,
    comments text,
    likes text,
    scraped_date int,
    _id serial
);
""")

    if format == 'instagram':
        dptr.write("""
COPY instagram (_id,""")
        dptr.write(','.join(KeyList))
    elif format == 'message':
        dptr.write("""
COPY messages (""")
        dptr.write(','.join(MessageKeyList))
    if format != 'json':
        dptr.write(""") FROM stdin;
""")
    outputFiles(fileData, dptr, format)
    if format != 'json':
        dptr.write("""\\.
""")
    if format == 'instagram':
        dptr.write("""
CREATE INDEX instagram_id_ix ON instagram (_id);
CREATE INDEX instagram_posted_date_ix ON instagram (posted_date);
CREATE INDEX instagram_caption_ix ON instagram USING gin
    (to_tsvector('english', caption));
""")
    sys.stderr.write('\n%d of %d\n' % (lenItems, processed))
    for arg in sys.argv[1:]:
        if arg.startswith('--match='):
            fptr = open(arg.split('=', 1)[1], 'wb')
            for match in fileData['matches']:
                fptr.write('%s\t%s\n' % (match, fileData['matches'][match]))
            fptr.close()
        if arg.startswith('--mentions='):
            fptr = open(arg.split('=', 1)[1], 'wb')
            fptr.write(json.dumps(fileData['mentions']))
            fptr.close()
