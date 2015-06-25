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
import os
import pprint
import random
import sys
import tempfile
import time
import zipfile

import fileutil


KeyList = [
    'user_name', 'user_id', 'posted_date', 'url', 'image_url', 'caption',
    'latitude', 'longitude', 'location_id', 'location_name',
    'comment_count', 'like_count'  # , 'comments', 'likes', 'scraped_date'
]


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


def jsonToItems(fptr, partial=False):
    """
    Given a file-like object containing json, read it in, and parse the
    elements in a structure like {'data': [{'data': [(elements)]}]}.  Return
    each element that has necessary metadata reformated to a standard
    dictionary of values.

    :param fptr: a file-like object with json.
    :param partial: if True, partial data is allowed.
    :yields: items parsed from the file.
    """
    for record in json.loads(fptr.read())['data']:
        for inst in record['data']:
            if (not inst.get('location', None) or
                    'latitude' not in inst['location'] or
                    'longitude' not in inst['location']):
                continue
            item = {
                'user_name':   inst['user']['username'],
                'user_id':     inst['user']['id'],
                'posted_date': inst['created_time'],
                'url':         inst['link'],
                'latitude':    inst['location']['latitude'],
                'longitude':   inst['location']['longitude'],
                'comment_count': inst['comments']['count'],
                'comments':    '',
                'like_count':  inst['likes']['count'],
                'likes':       '',
                'scraped_date': int(inst['created_time']),
            }
            if inst['caption']:
                item['caption'] = inst['caption']['text']
                item['scraped_date'] = max(
                    item['scraped_date'],
                    int(inst['caption'].get('created_time', 0)))
            if not partial:
                if 'id' in inst['location']:
                    item['location_id'] = inst['location']['id']
                if 'name' in inst['location']:
                    item['location_name'] = inst['location']['name']
                if 'data' in inst['comments']:
                    item['comments'] = '|'.join(['%s;%s;%s;%s' % (
                        comm['from']['username'], comm['from']['id'],
                        comm['created_time'], comm['text']
                    ) for comm in inst['comments']['data']])
                    for comm in inst['comments']['data']:
                        item['scraped_date'] = max(
                            item['scraped_date'],
                            int(comm.get('created_time', 0)))
                if 'data' in inst['likes']:
                    item['likes'] = '|'.join(['%s;%s' % (
                        like['username'], like['id']
                    ) for like in inst['likes']['data']])
            yield item


def outputFiles(fileData, dptr):
    """
    Based on a set of input files, shuffle each in turn and write it out.

    :param fileData: a dictionary of information that tracked file usage.
    :param dptr: the output file-like pointer.
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
            dptr.write('%d\t%s\n' % (id, line))
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


def processFiles(files, items, fileData):
    """
    Process the list of files, either determining the latest entry we have for
    each instagram message or storing the latest entries for final conversion.

    :param files: a list of files to process.
    :param items: a dictionary to track the latest entry for each item.
    :param fileData: a dictionary of information to tracked file usage to store
                     the results, or None to just compute the latest entry.
    :return: the number of items processed (which is usually more than the
             number of items returned).
    """
    processed = 0
    itemsStored = 0
    files_processed = 0
    for filerecord in files:
        (fptr, filename) = processFilesOpen(*filerecord)
        if filename.split('.')[-1].lower() == 'csv':
            itemlist = csvToItems(fptr, fileData is None)
        else:
            line = fptr.readline()
            # Not all formats support seeking back to zero, so just reopen
            (fptr, filename) = processFilesOpen(*filerecord)
            if 'tweet' in line:
                itemlist = twitterToItems(fptr, fileData is None, fileData)
            else:
                itemlist = jsonToItems(fptr, fileData is None)
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
            if item['url'].startswith('http://instagram.com/p/'):
                item['url'] = (
                    'i/' + item['url'].split('http://instagram.com/p/', 1)[1])
            item = [item.get(lkey, None) for lkey in KeyList]
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


def processFilesOpen(filetype, filename, subname, zptr):
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
        try:
            tw = json.loads(line.strip())
            date = int(calendar.timegm(dateutil.parser.parse(
                tw['created_at']).utctimetuple()))
            if date < dststart or date > dstend:
                date -= 18000
            else:
                date -= 14400
            item = {
                'user_name':     tw['user']['name'],
                'user_id':       tw['user']['id_str'],
                'posted_date':   date,
                'caption':       decoder.unescape(tw['text']),
                'url':           't/' + tw['user']['id_str'] + '/' +
                                 tw['id_str'],
                # 'comment_count': inst['comments']['count'],
                # 'comments':      '',
                'like_count':    tw.get('retweet_count', 0),
                # 'likes':         '',
                'latitude':      tw['coordinates']['coordinates'][1],
                'longitude':     tw['coordinates']['coordinates'][0],
                'scraped_date':  date
            }
            if 'instagr.am\\/p\\/' in line:
                item['hash'] = line.split('instagr.am\\/p\\/', 1)[1].split(
                    '\\/', 1)[0]
                if matches and not partial and 'matches' in matches:
                    matches['matches'][item['user_id']] = item['hash']
            if not partial:
                if ('entities' in tw and 'media' in tw['entities'] and
                        len(tw['entities']['media']) > 0 and
                        'media_url_https' in tw['entities']['media'][0]):
                    item['image_url'] = tw['entities']['media'][0][
                        'media_url_https']
                if tw.get('place', None):
                    if 'id' in tw['place']:
                        item['location_id'] = tw['place']['id']
                    if 'name' in tw['place']:
                        item['location_name'] = tw['place']['name']
        except Exception:
            sys.stderr.write(pprint.pformat(tw).strip() + '\n')
            raise
        yield item


if __name__ == '__main__':
    if len(sys.argv) < 2 or '--help' in sys.argv:
        print """Load instagram and twitter data files to a Postgres table.

Syntax: load_instagram.py [--noclear] [--match=(file)] (files) > (instagram.pg)

Files must not start with a dash.  Files can be json or csv, eitehr plain or
stored in zip, bzip2, or gzip files.  Zip, bzip2, and gzip files must end with
.zip, .bz2, and .gz respectively.  In a zip archive, only files within the
compressed file ending with .json or .csv are ingested.
--noclear doesn't drop or create the instagram table.
"""
        sys.exit()

    # Parse input files and store results in temporary files
    fileData = {'numFiles': 20, 'matches': {}}
    files = []
    for filespec in sys.argv[1:]:
        if filespec.startswith('-'):
            continue
        for filename in glob.iglob(filespec):
            if filename.lower().endswith('.zip'):
                zptr = zipfile.ZipFile(filename)
                files.extend(
                    [('zip', filename, subname, zptr)
                     for subname in zptr.namelist()
                     if subname.split('.')[-1].lower() in ('json', 'csv')])
            else:
                files.append(('file', filename, '', None))
    items = {}
    processFiles(files, items, None)
    lenItems = len(items)
    processed = processFiles(files, items, fileData)
    items = None

    # Output the results
    dptr = sys.stdout
    if '--noclear' not in sys.argv[1:]:
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

    dptr.write("""
COPY instagram (_id,""")
    dptr.write(','.join(KeyList))
    dptr.write(""") FROM stdin;
""")
    outputFiles(fileData, dptr)
    dptr.write("""\\.

CREATE INDEX instagram_id_ix ON instagram (_id);
CREATE INDEX instagram_posted_date_ix ON instagram (posted_date);
CREATE INDEX instagram_caption_ix ON instagram USING gin
    (to_tsvector('english', caption));
""")
    sys.stderr.write('\n%d of %d\n' % (lenItems, processed))
    for arg in sys.argv[1:]:
        if arg.startswith('--match=') and 'matches' in fileData:
            fptr = open(arg.split('=', 1)[1], 'wb')
            for match in fileData['matches']:
                fptr.write('%s\t%s\n' % (match, fileData['matches'][match]))
            fptr.close()
