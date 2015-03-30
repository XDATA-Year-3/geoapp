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

import csv
import datetime
import json
import md5
import pymongo
import random
import os
import subprocess
import sys
import tempfile
import time
import zipfile

import fileutil

DBName = 'taxi'


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

KeyTable = {
    'medallion': 'med',
    'hack_license': 'hack',
    'vendor_id': 'vid',
    'rate_code': 'code',
    'store_and_fwd_flag': 'fwd',
    'pickup_datetime': 'pdate',
    'dropoff_datetime': 'ddate',
    'passenger_count': 'count',
    'trip_time_in_secs': 'dur',
    'trip_distance': 'dist',
    'pickup_longitude': 'plon',
    'pickup_latitude': 'plat',
    'dropoff_longitude': 'dlon',
    'dropoff_latitude': 'dlat',
    'payment_type': 'type',
    'fare_amount': 'fare',
    'surcharge': 'sur',
    'mta_tax': 'tax',
    'tip_amount': 'tip',
    'tolls_amount': 'toll',
    'total_amount': 'total',

    'random': 'rnd'
}
CKeyTable = {
    'medallion': 'm',
    'hack_license': 'h',
    'vendor_id': 'v',
    'rate_code': 'c',
    'store_and_fwd_flag': 'fw',
    'pickup_datetime': 'pd',
    'dropoff_datetime': 'dd',
    'passenger_count': 'p',
    'trip_time_in_secs': 's',
    'trip_distance': 'd',
    'pickup_longitude': 'px',
    'pickup_latitude': 'py',
    'dropoff_longitude': 'dx',
    'dropoff_latitude': 'dy',
    'payment_type': 'ty',
    'fare_amount': 'f',
    'surcharge': 'sr',
    'mta_tax': 'tx',
    'tip_amount': 'tp',
    'tolls_amount': 'tl',
    'total_amount': 't',

    'random': 'r'
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

RevTable = {v: k for k, v in KeyTable.items()}
CRevTable = {v: k for k, v in CKeyTable.items()}


def copyDB(srcDB, destDB, opts={}):
    """
    Copy one database's trips table to another.  If shuffle is specified,
    randomize the order of the rows.

    :param srcDB: the name of the source database.
    :param destDB: the name of the destination database.
    :param opts: if 'random' is present and truthy, ensure that the new
                 base contains an appropriately named 'random' field that is in
                 the same order as the destination rows.  If random is missing
                 or falsy, ensure that such a field has been stripped from the
                 rows.  The opts dictionary also affects index creation on the
                 destination database.
    """
    randKey = getKey('random')
    starttime = time.time()
    client = getDbConnection(srcDB)
    database = client.get_default_database()
    srcColl = database['trips']
    rows = srcColl.find(spec={}, sort=[('_id', 1)], slave_okay=True,
                        compile_re=False, manipulate=False, timeout=False)
    numRows = rows.count()

    fileData = {'count': numRows}
    processed = 0
    for row in rows:
        if '_id' in row:
            del row['_id']
        if randKey in row:
            del row[randKey]
        dataToFiles(fileData, opts, row)
        processed += 1
        if not processed % 10000:
            elapsed = time.time() - starttime
            if elapsed:
                left = (numRows - processed) * (elapsed / processed)
            else:
                left = 0
            sys.stdout.write('%d/%d %3.1fs  %3.1fs left  \r' % (
                processed, numRows, elapsed, left))
            sys.stdout.flush()
        if False and processed == 250000:
            numRows = processed
            break
    if sys.platform == 'win32':
        os.system('net stop MongoDB >NUL 2>NUL')
        os.system('net start MongoDB >NUL 2>NUL')
    importFiles(fileData, opts, destDB)


def dataToFiles(fileData, opts={}, row=None):
    """
    Store a row of data in temporary files.  This allows importing the data
    using mongoimport when we are done, and also will distribute the data
    across multiple small files for quicker random shuffling if desired.

    :param fileData: a dictionary of information to track the file usage.  The
                     'count' key should be set to the approximate expected
                     number of rows to facilitate shuffling.
    :param opts: general command-line options.
    :param row: if not None, the python document to store.
    """
    if 'numFiles' not in fileData:
        if 'count' not in fileData or not opts.get('shuffle', False):
            numFiles = 1
        else:
            # assume the first row is representative for data size
            if row:
                rowLen = len(json.dumps(row)) + 1
            else:
                rowLen = 256
            roughFileSize = 256 * 1024 * 1024
            numFiles = int(fileData['count'] * rowLen / roughFileSize) + 1
        files = []
        for f in xrange(numFiles):
            (fd, filename) = tempfile.mkstemp('.json')
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
        files[fnum]['fptr'].write(json.dumps(row) + '\n')
        fileData['numRows'] += 1


def dehash(medallions=None, hacks=None):
    """
    Create tables that can be used to deanonymize the hack and medallion
    hashes.

    :param medallions: a list of known medallions.
    :param hacks: a list of known hack licenses.
    :return medallionTable: a dictionary with md5sum keys and dehashed values.
    :return hackTable: a dictionary with md5sum keys and dehashed values.
    """
    medallionTable = hackTable = {}

    if medallions and len(medallions):
        print 'Medallions', len(medallions)
        medallions = dict.fromkeys(medallions)
        table = {}
        letstr = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        for leadnum in ' 123456789':
            for num in xrange(1000):
                numvalue = '%d' % num
                for let in xrange((27 if leadnum == ' ' else 1)*27*26):
                    letvalue = (letstr[let / 702] + letstr[(let / 26) % 27] +
                                letstr[(let % 26) + 1])
                    if let >= 27 * 26 and not ((let / 26) % 27):
                        continue
                    value = (leadnum + letvalue + numvalue).replace(' ', '')
                    key = md5.new(value).hexdigest().upper()
                    if key in medallions:
                        table[key] = value
                        sys.stdout.write('%8s %d \r' % (
                            value, len(table)))
                        sys.stdout.flush()
        print 'Found %d medallion hashes out of %d' % (len(table),
                                                       len(medallions))
        medallionTable = table

    if hacks and len(hacks):
        print 'Hack Licenses', len(hacks)
        hacks = dict.fromkeys(hacks)
        table = {}
        # https://medium.com/@vijayp/of-taxis-and-rainbows-f6bc289679a1 claims
        # that the hack values are 6-digit numbers that may be zero-padded or
        # 7-digit numbers that start with 5.  I have found that there are other
        # values (and no values are zero-padded).  8-digit numbers cover the
        # data space.  The discrepency is probably due to data entry errors.
        for num in xrange(100000000):
            for pad in xrange(len('%d' % num), len('%d' % num) + 1):
                value = '%0*d' % (pad, num)
                key = md5.new(value).hexdigest().upper()
                if key in hacks:
                    table[key] = value
                    sys.stdout.write('%8s %d \r' % (value, len(table)))
                    sys.stdout.flush()
        for key in hacks:
            if key not in table:
                print 'Missing hack', key
        print 'Found %d hack hashes out of %d' % (len(table), len(hacks))
        hackTable = table
    return medallionTable, hackTable


def getDbConnection(db=None):
    """
    Connect to local mongo database named 'taxi'

    :param db: the name of the db to connect to.  If this starts with mongodb,
               it is the full mongodb uri.  If None, use DBName.
    :returns: a pymongo client.
    """
    clientOptions = {
        'connectTimeoutMS': 15000,
        # 'socketTimeoutMS': 60000,
    }
    if db is None:
        dbUri = 'mongodb://localhost:27017/' + DBName
    elif db.startswith('mongodb:'):
        dbUri = db
    else:
        dbUri = 'mongodb://localhost:27017/' + db
    retryTime = 1
    while True:
        try:
            client = pymongo.MongoClient(dbUri, **clientOptions)
            return client
        except pymongo.errors.ConnectionFailure:
            retryTime *= 2
            if retryTime > 128:
                raise
            print('MongoDB failed to connect.  Waiting %d s and trying '
                  'again.' % retryTime)
            if sys.platform == 'win32':
                os.system('net start MongoDB >NUL 2>NUL')
            time.sleep(retryTime)


def getKey(key):
    """
    Get the compact key from the key table.

    :param key: the key to fetch
    :returns: the preferred key to use.
    """
    return KeyTable.get(key, key)


def importFiles(fileData, opts={}, destDB=None):
    """
    Given data stored in temporary files, import the data into mongo.  If the
    data should be shuffled, shuffle it first.

    :param fileData: a dictionary of information that tracked file usage.
    :param destDB: the name of the destination database.
    :param opts: command line options.
    """
    global DBName
    if destDB:
        DBName = destDB
    else:
        destDB = DBName

    files = fileData['files']
    numRows = fileData['numRows']
    for f in files:
        f['fptr'].close()
    starttime = time.time()
    if opts.get('shuffle', False):
        (fd, filename) = tempfile.mkstemp('combined.json')
        print filename
        os.close(fd)
        fptr = fileutil.OpenWithoutCaching(filename, 'wb')
        processed = 0
        for f in files:
            data = fileutil.OpenWithoutCaching(
                f['name']).read().strip().split('\n')
            os.unlink(f['name'])
            random.shuffle(data)
            for line in data:
                fptr.write(line + '\n')
                processed += 1
                if not processed % 1000:
                    elapsed = time.time() - starttime
                    if elapsed:
                        left = (numRows - processed) * (elapsed / processed)
                    else:
                        left = 0
                    sys.stdout.write('%d/%d %3.1fs  %3.1fs left  \r' % (
                        processed, numRows, elapsed, left))
                    sys.stdout.flush()
            data = None
        fptr.close()
    else:
        filename = files[0]['name']

    if not destDB:
        return
    client = getDbConnection(destDB)
    database = client.get_default_database()
    destColl = database['trips']
    destColl.drop()
    destColl.drop_indexes()
    if not opts.get('dropIndex', False):
        indexTrips(opts)
    destColl = None
    cmd = ['mongoimport', '--db=' + destDB, '--collection=trips',
           '--file=' + filename, '--drop']
    subprocess.call(cmd)
    if not opts.get('keepFiles', False):
        os.unlink(filename)
    sys.stdout.write('Imported %3.1fs\n' % (time.time() - starttime, ))

    if opts.get('endIndex', False):
        starttime = time.time()
        sys.stdout.write('Indexing\n')
        indexTrips(opts)
        sys.stdout.write('Indexed %3.1fs\n' % (time.time() - starttime, ))


def indexTrips(opts={}):
    """
    Drop and then create indices on the trips collection.

    :param opts: options dictionary.  See readFiles().
    """
    client = getDbConnection()
    database = client.get_default_database()
    collection = database['trips']
    collection.drop_indexes()
    collection.ensure_index([(getKey('medallion'), 1)], background=True)
    collection.ensure_index([(getKey('hack_license'), 1)], background=True)
    collection.ensure_index([(getKey('pickup_datetime'), 1)], background=True)
    if opts.get('random', False):
        collection.ensure_index(
            [(getKey('random'), 1), (getKey('pickup_datetime'), 1)],
            background=True)


def processTrip(opts, epoch, fileData, trip):
    for key in trip:
        if trip[key] == '':
            trip[key] = None
        elif RevTable.get(key, key) in TypeTable:
            dataType = TypeTable[RevTable.get(key, key)]
            try:
                if dataType == 'date':
                    trip[key] = datetime.datetime.strptime(
                        trip[key], '%Y-%m-%d %H:%M:%S')
                    if opts.get('dateAsInt', False):
                        trip[key] = int((trip[key]-epoch).total_seconds()*1000)
                elif dataType == 'float':
                    trip[key] = float(trip[key])
                elif dataType == 'int':
                    trip[key] = int(trip[key])
            except ValueError:
                print 'ValueError', TypeTable[key], key, trip[key]
                sys.exit(0)
    if opts.get('random', False):
        trip[getKey('random')] = random.random()
    dataToFiles(fileData, opts, trip)


def readFiles(opts={}):
    """
    Read the taxi data from files in the local directory that are named
    trip_(data|fare)_{month}.csv.zip and store the data in the 'trips'
    collection of a mongo database at mongodb://localhost:27017/taxi.  Any
    existing trips collection is dropped.  The opts dictionary can contain the
    following items:
        dateAsInt: if True, store dates as epoch millisecond integers
        dropIndex: if True, do not create indices after dropping the collection
    an indices.
        endIndex: if True, create indices after loading data.
        fromMonth: if present, do not drop the collection before loading data,
    and load data starting at the 1-based month.
        random: if True, add a random number to each realized row.
        sampleRate: if a number, only keep a statistical average of 1 row in
    this many.
        toMonth: stop loading after the specified 1-based month (inclusive).

    :param opts: options dictionary.  See above.
    """
    epoch = datetime.datetime.utcfromtimestamp(0)
    dcount = rcount = 0
    starttime = time.time()
    medallions = {}
    hacks = {}
    numRows = 0
    for month in xrange(opts.get('fromMonth', 1), opts.get('toMonth', 12)+1):
        linecount = 0
        if opts.get('yellow', True):
            fare = zipfile.ZipFile('trip_fare_%d.csv.zip' % month)
            fare = csv.reader(fare.open(fare.namelist()[0]))
            fheader = [key.strip() for key in fare.next()]
            columns = {fheader[col]: col for col in xrange(len(fheader))}
            m_col = columns['medallion']
            h_col = columns['hack_license']
            linecount = 0
            for tripline in fare:
                medallions[tripline[m_col]] = True
                hacks[tripline[h_col]] = True
                linecount += 1
                numRows += 1
                if not linecount % 25000:
                    sys.stdout.write('%d %d %d %d %3.1fs\r' % (
                        month, linecount, len(medallions), len(hacks),
                        time.time() - starttime))
                    sys.stdout.flush()
        if opts.get('green', True):
            filename = 'lpep_trip%d.csv.zip' % month
            if os.path.exists(filename):
                data = zipfile.ZipFile(filename)
                data = csv.reader(data.open(data.namelist()[0]))
                dheader = [GreenKeyTable[key.strip()] for key in data.next()]
                columns = {dheader[col]: col for col in xrange(len(dheader))}
                linecount = 0
                for tripline in data:
                    linecount += 1
                    numRows += 1
                if not linecount % 25000:
                    sys.stdout.write('%d %d %d %d %3.1fs\r' % (
                        month, linecount, len(medallions), len(hacks),
                        time.time() - starttime))
                    sys.stdout.flush()
        sys.stdout.write('%d %d %d %d %3.1fs\n' % (
            month, linecount, len(medallions), len(hacks),
            time.time() - starttime))
        sys.stdout.flush()
    medallionTable, hackTable = dehash(medallions.keys(), hacks.keys())
    sys.stdout.write('Dehashed %3.1fs\n' % (time.time() - starttime))
    fileData = {'count': numRows}
    if opts.get('sampleRate', None):
        fileData['count'] = numRows / opts['sampleRate']
    for month in xrange(opts.get('fromMonth', 1), opts.get('toMonth', 12)+1):
        if opts.get('yellow', True):
            data = zipfile.ZipFile('trip_data_%d.csv.zip' % month)
            data = csv.reader(data.open(data.namelist()[0]))
            dheader = [getKey(key.strip()) for key in data.next()]
            fare = zipfile.ZipFile('trip_fare_%d.csv.zip' % month)
            fare = csv.reader(fare.open(fare.namelist()[0]))
            fheader = [getKey(key.strip()) for key in fare.next()]
            triples = {}
            for tripline in data:
                trip = dict(zip(dheader, [val.strip() for val in tripline]))
                tripkey = (trip[getKey('medallion')],
                           trip[getKey('hack_license')],
                           trip[getKey('pickup_datetime')])
                while tripkey not in triples:
                    fareline = fare.next()
                    if not fareline:
                        break
                    fdat = dict(zip(fheader, [
                        val.strip() for val in fareline]))
                    fdatkey = (fdat[getKey('medallion')], fdat[getKey(
                        'hack_license')], fdat[getKey('pickup_datetime')])
                    triples[fdatkey] = fdat
                if tripkey not in triples:
                    continue
                trip.update(triples[tripkey])
                del triples[tripkey]
                rcount += 1
                if (opts.get('sampleRate', None) and
                        random.random() * opts['sampleRate'] >= 1):
                    continue
                trip[getKey('medallion')] = medallionTable.get(
                    trip[getKey('medallion')], trip[getKey('medallion')])
                trip[getKey('hack_license')] = hackTable.get(
                    trip[getKey('hack_license')], trip[getKey('hack_license')])
                processTrip(opts, epoch, fileData, trip)
                dcount += 1
                if not dcount % 1000:
                    sys.stdout.write('%d %d %d %d %3.1fs \r' % (
                        month, dcount, rcount, len(triples),
                        time.time() - starttime))
                    sys.stdout.flush()

        if opts.get('green', True):
            filename = 'lpep_trip%d.csv.zip' % month
            if os.path.exists(filename):
                data = zipfile.ZipFile(filename)
                data = csv.reader(data.open(data.namelist()[0]))
                dheader = [getKey(GreenKeyTable[key.strip()])
                           for key in data.next()]
                columns = {dheader[col]: col for col in xrange(len(dheader))}
                for tripline in data:
                    trip = dict(zip(dheader, [
                        val.strip() for val in tripline]))
                    del trip['-']
                    processTrip(opts, epoch, fileData, trip)
                    dcount += 1
                    rcount += 1
                    if not dcount % 1000:
                        sys.stdout.write('%d %d %d %d %3.1fs \r' % (
                            month, dcount, rcount, 0,
                            time.time() - starttime))
                        sys.stdout.flush()

        data = None
        sys.stdout.write('%d %d %d %d %3.1fs \n' % (
            month, dcount, rcount, 0, time.time() - starttime))
    sys.stdout.write('-- %d %d -- %3.1fs \n' % (
        dcount, rcount, time.time() - starttime))
    sys.stdout.flush()
    importFiles(fileData, opts)


if __name__ == '__main__':
    help = False
    actions = {}
    opts = {'yellow': True, 'green': True}
    seed = 0
    for arg in sys.argv[1:]:
        if arg == '--compact':
            KeyTable = CKeyTable
            RevTable = CRevTable
        elif arg.startswith('--copy='):
            actions['copy'] = arg.split('=', 1)[1]
        elif arg.startswith('--db='):
            DBName = arg.split('=', 1)[1]
        elif arg == '--dropindex':
            opts['dropIndex'] = True
        elif arg == '--endindex':
            opts['dropIndex'] = True
            opts['endIndex'] = True
        elif arg.startswith('--from='):
            opts['fromMonth'] = int(arg.split('=', 1)[1])
        elif arg == '--green':
            opts['green'] = True
        elif arg == '--index':
            actions['index'] = True
        elif arg == '--intdate':
            opts['dateAsInt'] = True
        elif arg == '--keep':
            opts['keepFiles'] = True
        elif arg == '--nogreen':
            opts['green'] = False
        elif arg == '--noyellow':
            opts['yellow'] = False
        elif arg == '--random':
            opts['random'] = True
        elif arg == '--read':
            actions['read'] = True
        elif arg.startswith('--sample='):
            opts['sampleRate'] = float(arg.split('=', 1)[1])
        elif arg.startswith('--seed='):
            seed = arg.split('=', 1)[1]
        elif arg == '--shuffle':
            opts['shuffle'] = True
        elif arg.startswith('--to='):
            opts['toMonth'] = int(arg.split('=', 1)[1])
        elif arg == '--yellow':
            opts['yellow'] = True
        else:
            help = True
    if help or not len(actions):
        print """Load taxi zip files into a mongo database.

Syntax: load_taxi.py --db=(database) --read --index --copy=(database)
        --sample=(rate) --seed=(value) --random --dropindex --endindex
        --from=(month) --to=(month) --intdate --compact --shuffle --keep
        --yellow|--noyellow --green|--nogreen

--db specifies the database to use in mongo.  This defaults to 'taxi'.  If an
  empty string, don't write to any database (implies --keep).
--compact uses extra-compact keys for the database.
--copy copies the --db database to the --copy database.  The destination
  database will be indexed as per the --dropindex or --endindex options.  If
  --shuffle is specified, the data is copied in a random order.  If --random is
  not included, any random value will be stripped from the database rows.  If
  included, a value will be added in the order the rows are copied.
--dropindex to drop the indices and not recreate them.
--endindex recreates the indices at the end of the read process.
--from does not drop or reindex existing data, and loads from the specified
    1-based month number onward.
--green enables importing data for green cabs (default).
--index regenerates indices on the 'trips' collection.
--intdate stores dates as integers.
--keep keeps the json file used with mongoimport.
--nogreen and --noyellow disable importing data from the green or yellow cabs.
--random adds a random value from 0 to 1 to each row under the 'random' tag.
--read drops the 'trips' collection at mongodb://localhost:27017/taxi and reads
    it in from files in the local directory that are named
    trip_(data|fare)_{month}.csv.zip.
--sample picks a subset of rows.  Statistically, 1 row in (rate) is selected.
    The random seed affects which rows are selected.
--seed specifies a random number seed.  Default is 0.  Blank for no explicit
    seed.
--shuffle shuffles the data import.
--to stops loading after the specified 1-based month number (inclusive).
--yellow enables importing data for yellow cabs (default)."""
        sys.exit(0)
    starttime = time.time()
    if 'index' in actions:
        indexTrips(opts)
    if seed != '':
        random.seed(int(seed))
    if 'read' in actions:
        readFiles(opts)
    if 'copy' in actions:
        copyDB(DBName, actions['copy'], opts)
    print 'Total time %3.1fs' % (time.time() - starttime)
