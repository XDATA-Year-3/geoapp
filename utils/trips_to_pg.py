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
import json
import os
import random
import sys
import tempfile
import time
import zipfile

import fileutil

TypeTable = {
    'dropoff_datetime': 'date',
    'dropoff_latitude': 'float',
    'dropoff_longitude': 'float',
    'passenger_count': 'int',
    'pickup_datetime': 'date',
    'pickup_latitude': 'float',
    'pickup_longitude': 'float',
    'rate_code': 'int',
    'trip_distance': 'float',
    'trip_time_in_secs': 'int',

    'fare_amount': 'float',
    'mta_tax': 'float',
    'surcharge': 'float',
    'tip_amount': 'float',
    'tolls_amount': 'float',
    'total_amount': 'float',
}

GreenKeyTable = {
    'lpep_pickup_datetime': 'pickup_datetime',
    'Lpep_dropoff_datetime': 'dropoff_datetime',
    'Store_and_fwd_flag': 'store_and_fwd_flag',
    'RateCodeID': 'rate_code',
    'Pickup_longitude': 'pickup_longitude',
    'Pickup_latitude': 'pickup_latitude',
    'Dropoff_longitude': 'dropoff_longitude',
    'Dropoff_latitude': 'dropoff_latitude',
    'Passenger_count': 'passenger_count',
    'Trip_distance': 'trip_distance',
    'Fare_amount': 'fare_amount',
    'Extra': 'surcharge',
    'MTA_tax': 'mta_tax',
    'Tip_amount': 'tip_amount',
    'Tolls_amount': 'tolls_amount',
    'Ehail_fee': '-',
    'Total_amount': 'total_amount',
    'Payment_type': 'payment_type',
    'Distance_between_service': 'trip_distance',
    'Time_between_service': 'trip_time_in_secs',
    'Trip_type': '-'
}

BikeShareKeyTable = {
    'Duration': 'trip_time_in_secs',
    'Start date': 'pickup_datetime',
    'Start Station': 'start_station',
    'Start terminal': '-',
    'End date': 'dropoff_datetime',
    'End Station': 'end_station',
    'End terminal': '-',
    'Bike#': 'medallion',
    'Subscription Type': 'payment_type',
    'Member Type': 'payment_type',
    'Subscriber Type': 'payment_type',
    'Total duration (ms)': 'trip_time_in_secs',
    'Start station': 'start_station',
    'End station': 'end_station',
    'Start time': 'pickup_datetime',
    'Bike number': 'medallion',
}

BostonKeyTable = {
    'TRIP_ID': 'id',
    'TID': 'id',
    'ID': 'id',
    'OBJECTID': 'id',
    'DROPTIME': 'dropoff_datetime',
    'DROPOFF_TIME': 'dropoff_datetime',
    'end_date': 'dropoff_datetime',
    'PICKUP_TIME': 'pickup_datetime',
    'PICKUPTIME': 'pickup_datetime',
    'start_date': 'pickup_datetime',
    'time': 'time',
    'time_': 'time',
    'tim': 'time',
    'DROPADDRESS': '-',
    'DROPOFF_ADDRESS': '-',
    'PICKUPADDRESS': '-',
    'PICKUP_ADDRESS': '-',
    'DROPLONG': 'dropoff_longitude',
    'DROPOFF_LONG': 'dropoff_longitude',
    'end_gps_lo': 'dropoff_longitude',
    'PICKUPLONG': 'pickup_longitude',
    'PICKUP_LONG': 'pickup_longitude',
    'start_gps_lo': 'pickup_longitude',
    'start_gps_': 'pickup_longitude',
    'DROPLAT': 'dropoff_latitude',
    'DROPOFF_LAT': 'dropoff_latitude',
    'end_gps_la': 'dropoff_latitude',
    'PICKUPLAT': 'pickup_latitude',
    'PICKUP_LAT': 'pickup_latitude',
    'start_gps_la': 'pickup_latitude',
    'start_gps1': 'pickup_latitude',
    'zip': '-',
    'ZIP': '-',
}

Epoch = datetime.datetime.utcfromtimestamp(0)
Rainbow = {}
BikeShare = {}


KeyList = [
    'medallion', 'hack_license', 'vendor_id', 'store_and_fwd_flag',
    'payment_type',

    'dropoff_datetime', 'dropoff_latitude', 'dropoff_longitude',
    'pickup_datetime', 'pickup_latitude', 'pickup_longitude',
    'passenger_count', 'rate_code', 'trip_distance', 'trip_time_in_secs',

    'fare_amount', 'mta_tax', 'surcharge', 'tip_amount', 'tolls_amount',
    'total_amount',

    'ingest_source', 'service', 'region',
]
IngestTime = time.time()


def bikeShareToItems(fptr):
    """
    Based on a Bike Share data set, generate our standard items.

    :param fptr: the open data file.
    :yields: a list of items.
    """
    data = csv.reader(fptr)
    dheader = [BikeShareKeyTable[key.strip()] for key in data.next()]
    for tripline in data:
        item = dict(zip(dheader, [val.strip() for val in tripline]))
        val = item.get('trip_time_in_secs', '').split()
        if 'h' in val[0]:
            item['trip_time_in_secs'] = (
                int(val[0].strip('h')) * 3600 +
                int(val[1].strip('m')) * 60 + int(val[2].strip('s')))
        elif val[0]:
            item['trip_time_in_secs'] = int(val[0]) / 1000
        if (item.get('start_station', '') not in BikeShare or
                item.get('end_station', '') not in BikeShare):
            continue
        item['pickup_latitude'], item['pickup_longitude'] = BikeShare[
            item['start_station']]
        item['dropoff_latitude'], item['dropoff_longitude'] = BikeShare[
            item['end_station']]
        retypeItem(item, False, True)
        yield item


def bostonToItems(pfptr, filerecord, files):
    """
    Based on a Boston taxi data set, generate our standard items.

    :param pfptr: the open pickup file.
    :param filerecord: the fare file record.
    :param files: a list of files that contains a corresponding dropoff file.
    :yields: a list of items.
    """
    dropfilename = filerecord['filename'].replace('Start', 'End').replace(
        'pickup', 'dropoff')
    dfptr = None
    for dfilerecord in files:
        if dfilerecord['filename'] == dropfilename:
            (dfptr, dfilename) = processFilesOpen(**dfilerecord)
            break
    if dfptr is None:
        raise Exception('No matching dropoff file')
    trips = {}
    pick = csv.reader(pfptr)
    pheader = [BostonKeyTable[key.strip()] for key in pick.next()]
    for tripline in pick:
        item = dict(zip(pheader, [val.strip() for val in tripline]))
        if 'time' in item:
            item['pickup_datetime'] = (
                item['pickup_datetime'].split(' ')[0] + ' ' + item['time'])
        if item['pickup_latitude'] == 0:
            continue
        trips[item['id']] = item
    drop = csv.reader(dfptr)
    dheader = [BostonKeyTable[key.strip()] for key in drop.next()]
    for tripline in drop:
        item = dict(zip(dheader, [val.strip() for val in tripline]))
        if 'time' in item:
            item['dropoff_datetime'] = (
                item['dropoff_datetime'].split(' ')[0] + ' ' + item['time'])
        if item['dropoff_latitude'] == 0:
            continue
        if item['id'] in trips:
            trips[item['id']].update(item)
        else:
            trips[item['id']] = item
    for id in trips:
        item = trips[id]
        del item['id']
        retypeItem(item, False, True)
        item['pickup_datetime'] = item.get('pickup_datetime',
                                           item.get('dropoff_datetime', None))
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


def getItemList(filerecord, files):
    """
    Given a file record, return an item list.

    :param filerecord: the file record to process.
    :param files: the list of files that includes the filerecord.
    :returns: itemlist, ingestSource, service, and filename for the filerecord.
              itemlist is None if we couldn't determine what to do with the
              file and False if we should skip the file.
    """
    ingestSource = service = None
    (fptr, filename) = processFilesOpen(**filerecord)
    firstline = fptr.readline()
    (fptr, filename) = processFilesOpen(**filerecord)
    itemlist = None
    if filename.split('.')[-1].lower() == 'csv':
        if 'hack_license' in firstline and 'rate_code' in firstline:
            itemlist = False
        elif 'hack_license' in firstline and 'mta_tax' in firstline:
            itemlist = yellowToItems(fptr, filerecord, files)
            ingestSource = 'yellow_foi'
            service = 'x'
        elif 'lpep_pickup' in firstline:
            itemlist = greenToItems(fptr)
            ingestSource = 'green'
            service = 'x'
        elif 'start station' in firstline.lower():
            itemlist = bikeShareToItems(fptr)
            ingestSource = 'bikeshare'
            service = 'b'
        elif ('end_gps' in firstline or 'DROPOFF_TIME' in firstline or
                'DROPTIME' in firstline):
            itemlist = False
        elif ('start_gps' in firstline or 'PICKUP_TIME' in firstline or
                'PICKUPTIME' in firstline):
            itemlist = bostonToItems(fptr, filerecord, files)
            ingestSource = 'boston'
            service = 'x'
    if itemlist is None:
        sys.stderr.write('Failed to process file %s\n%s\n' % (
            filename, firstline))
    return itemlist, ingestSource, service, filename


def greenToItems(fptr):
    """
    Based on a green taxi data set, generate our standard items.

    :param fptr: the open green data file.
    :yields: a list of items.
    """
    data = csv.reader(fptr)
    dheader = [GreenKeyTable[key.strip()] for key in data.next()]
    for tripline in data:
        item = dict(zip(dheader, [val.strip() for val in tripline]))
        retypeItem(item)
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
    keylist = KeyList
    for filerecord in files:
        files_processed += 1
        region = filerecord.get('region', None)
        itemlist, ingestSource, service, filename = getItemList(
            filerecord, files)
        if itemlist is None or itemlist is False:
            continue
        for item in itemlist:
            if not processed % 1000:
                sys.stderr.write('%4d/%4d %9d/%9d\r' % (
                    files_processed, len(files), itemsStored, processed))
                sys.stderr.flush()
            processed += 1
            try:
                # Check that these are reasonable and castable to the
                # expected data type
                lat = float(item.get('pickup_latitude',
                            item.get('dropoff_latitude', None)))
                lon = float(item.get('pickup_longitude',
                            item.get('dropoff_longitude', None)))
                if (not int(item['pickup_datetime']) or
                        lat < -90 or lat > 90 or lon < -180 or lon > 180 or
                        (not lat and not lon)):
                    continue
            except Exception:
                continue
            item['region'] = region
            item['service'] = service
            item['ingest_source'] = ingestSource
            item = [item.get(lkey, None) for lkey in keylist]
            # Escape for Postgres bulk import
            item = ['\\N' if col is None else unicode(col).replace(
                '\t', ' ').replace('\r', ' ').replace('\n', ' ').replace(
                '\v', ' ').replace('\f', ' ').replace('\b', ' ').replace(
                '\\', '\\\\') for col in item]
            item = '\t'.join(item)
            dataToFiles(fileData, item)
            itemsStored += 1
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


def retypeItem(item, useRainbow=False, generalDates=False):
    """
    Cast appropriate fields to our desired datatypes.

    :param item: the item to adjust.
    :param useRainbow: if True, convert medallion and hack licenses using the
                       rainbow table.
    :param generalDates: True to use a general date parsing method.
    """
    for key in item:
        if item[key] == '' or item[key] is None:
            item[key] = None
            continue
        dataType = TypeTable.get(key, None)
        if dataType == 'date':
            if not generalDates:
                item[key] = datetime.datetime.strptime(
                    item[key], '%Y-%m-%d %H:%M:%S')
                item[key] = int((item[key] - Epoch).total_seconds())
            else:
                item[key] = int(calendar.timegm(dateutil.parser.parse(
                    item[key]).utctimetuple()))
        elif dataType == 'float':
            item[key] = float(item[key])
        elif dataType == 'int':
            item[key] = int(item[key])
        elif useRainbow and key == 'medallion' and 'medallion' in Rainbow:
            item[key] = Rainbow['medallion'].get(item[key], item[key])
        elif useRainbow and key == 'hack_license' and 'hack' in Rainbow:
            item[key] = Rainbow['hack'].get(item[key], item[key])


def yellowToItems(fptr, filerecord, files):
    """
    Convert a file of yellow taxi data to items we can store.

    :param fptr: the open fare file.
    :param filerecord: the fare file record.
    :param files: a list of files that contains a corresponding trip data file.
    :yields: a list of items.
    """
    datafilename = filerecord['filename'].replace('trip_fare', 'trip_data')
    dptr = None
    for dfilerecord in files:
        if dfilerecord['filename'] == datafilename:
            (dptr, dfilename) = processFilesOpen(**dfilerecord)
            break
    if dptr is None:
        raise Exception('No matching data file')
    fare = csv.reader(fptr)
    fheader = [key.strip() for key in fare.next()]
    data = csv.reader(dptr)
    dheader = [key.strip() for key in data.next()]
    for tripline in data:
        item = dict(zip(dheader, [val.strip() for val in tripline]))
        fareline = fare.next()
        faredict = dict(zip(fheader, [val.strip() for val in fareline]))
        if (item['medallion'] != faredict['medallion'] or
                item['hack_license'] != faredict['hack_license'] or
                item['pickup_datetime'] != faredict['pickup_datetime']):
            raise Exception('Unmatched fare and trip data')
        item.update(faredict)
        retypeItem(item, True)
        yield item


if __name__ == '__main__':
    if len(sys.argv) < 2 or '--help' in sys.argv:
        print """Load taxi and bike share data files to a Postgres table.

Syntax: trips_to_pg.py [--bikeshare=(file)] [--rainbow=(file)] (files)
                       > (data.pg)

Files must not start with a dash.  Files can be json or csv, either plain or
stored in zip, bzip2, or gzip files.  Zip, bzip2, and gzip files must end with
.zip, .bz2, and .gz respectively.  In a zip archive, only files within the
compressed file ending with .json or .csv are ingested.
--bikeshare specifies a json file with coordinates for Bike Share addresses.
--rainbow specifies a json file with medallion and hack dictionaries.
"""
        sys.exit()

    # Parse input files and store results in temporary files
    fileData = {}
    for arg in sys.argv[1:]:
        if arg.startswith('--bikeshare='):
            BikeShare = json.load(open(arg.split('=', 1)[1]))
        elif arg.startswith('--rainbow='):
            Rainbow = json.load(open(arg.split('=', 1)[1]))
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
            elif os.path.isfile(filename):
                files.append({'filename': filename, 'region': region})
    fileData['numFiles'] = len(files)
    items = {}
    processed = processFiles(files, items, fileData)
    items = None

    # Output the results
    dptr = sys.stdout
    dptr.write("""
COPY trips (""")
    dptr.write(','.join(KeyList))
    dptr.write(""") FROM stdin;
""")
    outputFiles(fileData, dptr)
    dptr.write("""\\.
""")
    sys.stderr.write('\n%d\n' % (processed))
