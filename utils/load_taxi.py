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
import mmap
import pymongo
import random
import os
import sys
import tempfile
import time
import zipfile


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

RevTable = {v: k for k, v in KeyTable.items()}
CRevTable = {v: k for k, v in CKeyTable.items()}


def copyDB(srcDB, destDB, opts={}):
    """
    Copy one database's trips table to another, randomizing the order of the
    rows.

    :param srcDB: the name of the source database.
    :param destDB: the name of the destination database.
    :param opts: if 'random' is present and truthy, ensure that the new
                 base contains an appropriately named 'random' field that is in
                 the same order as the destination rows.  If random is missing
                 or falsy, ensure that such a field has been stripped from the
                 rows.  The opts dictionary also affects index creation on the
                 destination database.
    """
    global DBName
    DBName = destDB

    randKey = getKey('random')
    starttime = time.time()
    client = getDbConnection(srcDB)
    database = client.get_default_database()
    srcColl = database['trips']
    rows = srcColl.find(spec={}, sort=[('_id', 1)], slave_okay=True,
                        complie_re=False, manipulate=False, timeout=False)
    numRows = rows.count()
    numFiles = int(numRows / 1024 / 1024 / 2) + 1
    files = []
    for f in xrange(numFiles):
        (fd, filename) = tempfile.mkstemp()
        os.close(fd)
        fptr = open(filename, 'w+b')
        files.append({'name': filename, 'fptr': fptr, 'starts': [0]})
    processed = 0
    for row in rows:
        if '_id' in row:
            del row['_id']
        if randKey in row:
            del row[randKey]
        fnum = random.randint(0, numFiles-1)
        files[fnum]['fptr'].write(json.dumps(row)+',\n')
        files[fnum]['starts'].append(files[fnum]['fptr'].tell())
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
    for f in files:
        f['fptr'].close()
                    
    if sys.platform == 'win32':
        os.system('net stop MongoDB >NUL 2>NUL')
        os.system('net start MongoDB >NUL 2>NUL')

    starttime = time.time()
    (fd, filename) = tempfile.mkstemp('.json')
    print filename
    os.close(fd)
    fptr = open(filename, 'w+b')
    processed = 0
    usemmap = False
    for f in files:
        starts = f['starts']
        if usemmap:
            fd = os.open(f['name'], os.O_RDONLY)
            data = mmap.mmap(fd, 0, access=mmap.ACCESS_READ)
        else:
            data = open(f['name']).read()
            os.unlink(f['name'])
        pickList = range(len(starts)-1)
        random.shuffle(pickList)
        for pick in pickList:
            fptr.write(data[starts[pick]:starts[pick+1]])
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
        if usemmap:
            data.close()
            os.close(fd)
            os.unlink(f['name'])
            fd = None
        data = None
    fptr.close()
    
    client = getDbConnection(destDB)
    database = client.get_default_database()
    destColl = database['trips']
    destColl.drop()
    destColl.drop_indexes()
    if not opts.get('dropIndex', False):
        indexTrips(opts)
    destColl = None

    cmd = ('""c:\\Program Files\\MongoDB 2.6 Standard\\bin\\mongoimport.exe" ' 
        '--db=%s --collection=trips --file="%s" --drop""' % (destDB, filename))
    os.system(cmd)
    os.unlink(filename)
    
    if opts.get('endIndex', False):
        starttime = time.time()
        sys.stderr.write('Indexing\n')
        indexTrips(opts)
        sys.stderr.write('Indexed %3.1fs\n' % (time.time() - starttime, ))


def dehash(medallions=None, hacks=None):
    """
    Create tables that can be used to deanonymize the hack and medallion 
    hashes.

    :param medallions: a list of known medallions.
    :param hacks: a list of known hack licenses.
    :return medallionTable: a dictionary with md5sum keys and dehashed values.
    :return hackTable: a dictionary with md5sum keys and dehashed values.
    """
    medallionTable = hackTable = None

    if medallions:
        MainKey = getKey('medallion')
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
                        sys.stderr.write('%8s %d \r' % (
                            value, len(table)))
                        sys.stderr.flush()
        print 'Found %d medallion hashes out of %d' % (len(table),
                                                       len(medallions))
        medallionTable = table

    if hacks:
        MainKey = getKey('hack_license')
        print 'Hack Licenses', len(hacks)
        hacks = dict.fromkeys(hacks)
        table = {}
        # https://medium.com/@vijayp/of-taxis-and-rainbows-f6bc289679a1 claims
        # that the hack values are 6-digit numbers that may be zero-padded or
        # 7-digit numbers that start with 5.  I have found that there are other
        # values (and no values are zero-padded).  8-digit numbers cover the
        # data space.  The discrepency is probably due to data entry errors.
        for num in xrange(100000000):
            #for pad in xrange(len('%d' % num), 8 + 1):
            for pad in xrange(len('%d' % num), len('%d' % num) + 1):
                value = '%0*d' % (pad, num)
                key = md5.new(value).hexdigest().upper()
                if key in hacks:
                    table[key] = value
                    sys.stderr.write('%8s %d \r' % (value, len(table)))
                    sys.stderr.flush()
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
    return KeyTable.get(key, key)


def indexTrips(opts={}, uniqueTrips=False):
    """
    Drop and then create indices on the trips collection.

    :param opts: options dictionary.  See readFiles().
    :param uniqueTrips: True to enforce (medallion, hack_license,
                        pickup_datetime) tuple uniqueness.
    """
    client = getDbConnection()
    database = client.get_default_database()
    collection = database['trips']
    collection.drop_indexes()
    if uniqueTrips:
        collection.ensure_index(
            [(getKey('medallion'), 1), (getKey('hack_license'), 1),
             (getKey('pickup_datetime'), 1)], background=True)
    collection.ensure_index([(getKey('medallion'), 1)], background=True)
    collection.ensure_index([(getKey('hack_license'), 1)], background=True)
    collection.ensure_index([(getKey('pickup_datetime'), 1)], background=True)
    if opts.get('random', False):
        collection.ensure_index(
            [(getKey('random'), 1), (getKey('pickup_datetime'), 1)],
            background=True)


def readFiles(opts={}, uniqueTrips=False):
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
    :param uniqueTrips: True to enforce (medallion, hack_license,
                        pickup_datetime) tuple uniqueness.
    """
    epoch = datetime.datetime.utcfromtimestamp(0)
    client = getDbConnection()
    database = client.get_default_database()
    collection = database['trips']
    if not 'fromMonth' in opts:
        collection.drop()
        collection.drop_indexes()
        if not opts.get('dropIndex', False):
            indexTrips(opts)
    dcount = rcount = 0
    usedkeys = {}
    starttime = time.time()
    medallions = {}
    hacks = {}
    for month in xrange(opts.get('fromMonth', 1), opts.get('toMonth', 12)+1):
        data = zipfile.ZipFile('trip_data_%d.csv.zip' % month)
        data = csv.reader(data.open(data.namelist()[0]))
        dheader = [key.strip() for key in data.next()]
        columns = {dheader[col]: col for col in xrange(len(dheader))}
        m_col = columns['medallion']
        h_col = columns['hack_license']
        linecount = 0
        for tripline in data:
            medallions[tripline[m_col]] = True
            hacks[tripline[h_col]] = True
            linecount += 1
            if not linecount % 10000:
                sys.stderr.write('%d %d %d %d %3.1fs\r' % (
                    month, linecount, len(medallions), len(hacks),
                    time.time() - starttime))
                sys.stderr.flush()
        sys.stderr.write('%d %d %d %d %3.1fs\n' % (
            month, linecount, len(medallions), len(hacks),
            time.time() - starttime))
        sys.stderr.flush()
    medallionTable, hackTable = dehash(medallions.keys(), hacks.keys())
    for month in xrange(opts.get('fromMonth', 1), opts.get('toMonth', 12)+1):
        data = zipfile.ZipFile('trip_data_%d.csv.zip' % month)
        data = csv.reader(data.open(data.namelist()[0]))
        dheader = [getKey(key.strip()) for key in data.next()]
        fare = zipfile.ZipFile('trip_fare_%d.csv.zip' % month)
        fare = csv.reader(fare.open(fare.namelist()[0]))
        fheader = [getKey(key.strip()) for key in fare.next()]
        bulk = collection.initialize_unordered_bulk_op()
        triples = {}
        for tripline in data:
            trip = dict(zip(dheader, [val.strip() for val in tripline]))
            tripkey = (trip[getKey('medallion')], trip[getKey('hack_license')],
                trip[getKey('pickup_datetime')])
            if (trip[getKey('medallion')] in usedkeys and trip[getKey(
                    'hack_license')] in usedkeys[trip[getKey('medallion')]] and
                    trip[getKey('pickup_datetime')] in usedkeys[trip[getKey(
                    'medallion')]][trip[getKey('hack_license')]]):
                continue
            while tripkey not in triples:
                fareline = fare.next()
                if not fareline:
                    break
                fdat = dict(zip(fheader, [val.strip() for val in fareline]))
                fdatkey = (fdat[getKey('medallion')], fdat[getKey(
                    'hack_license')], fdat[getKey('pickup_datetime')])
                triples[fdatkey] = fdat
            if tripkey not in triples:
                continue
            trip.update(triples[tripkey])
            del triples[tripkey]
            if uniqueTrips:
                usedkeys.default(trip[getKey('medallion')], {}).default(
                    trip[getKey('hack_license')], {})[trip[getKey(
                    'pickup_datetime')]] = True
            rcount += 1
            if (opts.get('sampleRate', None) and
                    random.random() * opts['sampleRate'] >= 1):
                continue
            trip[getKey('medallion')] = medallionTable.get(
                trip[getKey('medallion')], trip[getKey('medallion')])
            trip[getKey('hack_license')] = hackTable.get(
                trip[getKey('hack_license')], trip[getKey('hack_license')])

            for key in trip:
                if trip[key] == '':
                    trip[key] = None
                elif RevTable.get(key, key) in TypeTable:
                    dataType = TypeTable[RevTable.get(key, key)]
                    try:
                        if dataType == 'date':
                            trip[key] = datetime.datetime.strptime(
                                trip[key],'%Y-%m-%d %H:%M:%S')
                            if opts.get('dateAsInt', False):
                                trip[key] = int(
                                    (trip[key]-epoch).total_seconds()*1000)
                        elif dataType == 'float':
                            trip[key] = float(trip[key])
                        elif dataType == 'int':
                            trip[key] = int(trip[key])
                    except ValueError:
                        print 'ValueError', TypeTable[key], key, trip[key]
                        sys.exit(0)
            if opts.get('random', False):
                trip[getKey('random')] = random.random()
            bulk.insert(trip)
            dcount += 1
            if not dcount % 1000:
                sys.stderr.write('%d %d %d %d %3.1fs \r' % (
                    month, dcount, rcount, len(triples),
                    time.time() - starttime))
                sys.stderr.flush()
                bulk.execute()
                # Reload the database connection
                if not dcount % 1000000:
                    sys.stderr.write('\n')
                    collection = None
                    database = None
                    client = None
                    if sys.platform == 'win32':
                        os.system('net stop MongoDB >NUL 2>NUL')
                        os.system('net start MongoDB >NUL 2>NUL')
                    client = getDbConnection()
                    database = client.get_default_database()
                    collection = database['trips']
                    sys.stderr.write('Restarted database\n')
                bulk = collection.initialize_unordered_bulk_op()
        bulk.execute()
        data = None
        sys.stderr.write('%d %d %d %d %3.1fs \n' % (
            month, dcount, rcount, len(triples), time.time() - starttime))
    sys.stderr.write('-- %d %d -- %3.1fs \n' % (
        dcount, rcount, time.time() - starttime))
    sys.stderr.flush()
    if opts.get('endIndex', False):
        sys.stderr.write('Indexing\n')
        indexTrips(opts)
        sys.stderr.write('Indexed %3.1fs\n' % (time.time() - starttime, ))


if __name__ == '__main__':
    help = False
    actions = {}
    opts = {}
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
        elif arg == '--index':
            actions['index'] = True
        elif arg == '--intdate':
            opts['dateAsInt'] = True
        elif arg == '--random':
            opts['random'] = True
        elif arg == '--read':
            actions['read'] = True
        elif arg.startswith('--sample='):
            opts['sampleRate'] = float(arg.split('=', 1)[1])
        elif arg.startswith('--seed='):
            seed = arg.split('=', 1)[1]
        elif arg.startswith('--to='):
            opts['toMonth'] = int(arg.split('=', 1)[1])
        else:
            help = True
    if help or not len(actions):
        print """Load taxi zip files into a mongo database.

Syntax: load_taxi.py --db=(database) --read --index --copy=(database)
        --sample=(rate) --seed=(value) --random --dropindex --endindex
        --from=(month) --to=(month) --intdate --compact

--db specifies the database to use in mongo.  This defaults to 'taxi'.
--compact uses extra-compact keys for the database.
--copy copies the --db database to the --copy database using a random order.
  The destination database will be indexed as per the --dropindex or --endindex
  options.  If --random is not included, any random value will be stripped from
  the database rows.  If included, a value will be added in the order the rows
  are copied.
--dropindex to drop the indices and not recreate them.
--endindex recreates the indices at the end of the read process.
--from does not drop or reindex existing data, and loads from the specified
    1-based month number onward.
--index regenerates indices on the 'trips' collection.
--intdate stores dates as integers.
--random adds a random value from 0 to 1 to each row under the 'random' tag.
--read drops the 'trips' collection at mongodb://localhost:27017/taxi and reads
    it in from files in the local directory that are named
    trip_(data|fare)_{month}.csv.zip.
--sample picks a subset of rows.  Statistically, 1 row in (rate) is selected.
    The random seed affects which rows are selected.
--seed specifies a random number seed.  Default is 0.  Blank for no explicit
    seed.
--to stops loading after the specified 1-based month number (inclusive)."""
        sys.exit(0)
    if 'index' in actions:
        indexTrips(opts)
    if seed != '':
        random.seed(int(seed))
    if 'read' in actions:
        readFiles(opts)
    if 'copy' in actions:
        copyDB(DBName, actions['copy'], opts)
