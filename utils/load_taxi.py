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
import md5
import pymongo
import random
import os
import sys
import time
import zipfile


CollectionName = 'taxi'


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


def dehash(medallions=None, hacks=None):
    """
    Create a hacks and a medallions collection in the mongo database at
    mongodb://localhost:27017/taxi that can be used to deanonymize the hack and
    medallion hashes.

    :param medallions: a list of known medallions.  None to fetch it from the
                       database.
    :param hacks: a list of known hack licenses.  None to fetch it from the
                  database.
    :return medallionTable: a dictionary with md5sum keys and dehashed values.
    :return hackTable: a dictionary with md5sum keys and dehashed values.
    """
    client = None
    if not medallions or not hacks:
        client = getDbConnection()
        database = client.get_default_database()

    if True:
        MainKey = getKey('medallion')
        if client:
            collection = database['medallions']
            collection.drop()
            medallions = list(database['trips'].find(
                {}, fields=[MainKey]).distinct(MainKey))
        print 'Medallions', len(medallions), medallions[:5]
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
        for key in medallions:
            if key not in table:
                print 'Missing medallion', key
        print 'Found %d medallion hashes out of %d' % (len(table),
                                                       len(medallions))
        if client:
            for key in table:
                collection.save({MainKey: key, 'value': table[key]})
        medallionTable = table

    if True:
        MainKey = getKey('hack_license')
        if client:
            collection = database['hacks']
            collection.drop()
            hacks = list(database['trips'].find(
                {}, fields=[MainKey]).distinct(MainKey))
        print 'Hack Licenses', len(hacks), hacks[:5]
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
                    if ((num>=1000000 and num<5000000) or num>=6000000 or
                            value.startswith('0')):
                        sys.stderr.write('\n')
        for key in hacks:
            if key not in table:
                print 'Missing hack', key
        print 'Found %d hack hashes out of %d' % (len(table), len(hacks))
        if client:
            for key in table:
                collection.save({MainKey: key, 'value': table[key]})
        hackTable = table
    return medallionTable, hackTable


def getDbConnection():
    """
    Connect to local mongo database named 'taxi'

    :returns: client: a pymongo client.
    """
    clientOptions = {
        'connectTimeoutMS': 15000,
        # 'socketTimeoutMS': 60000,
    }
    dbUri = 'mongodb://localhost:27017/' + CollectionName
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


def indexTrips(uniqueTrips=False):
    """
    Drop and then create indices on the trips collection.

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
        sampleRate: if a number, only keep a statistical average of 1 row in
    this many.
        random: if True, add a random number to each realized row.

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
        indexTrips()
    dcount = rcount = 0
    usedkeys = {}
    for month in xrange(opts.get('fromMonth', 1), opts.get('toMonth', 12)+1):
        data = zipfile.ZipFile('trip_data_%d.csv.zip' % month)
        data = csv.reader(data.open(data.namelist()[0]))
        dheader = [getKey(key.strip()) for key in data.next()]
        medallions = {}
        hacks = {}
        triples = {}
        linecount = 0
        for tripline in data:
            trip = dict(zip(dheader, [val.strip() for val in tripline]))
            medallions[trip[getKey('medallion')]] = True
            hacks[trip[getKey('hack_license')]] = True
            linecount += 1
            if not linecount % 10000:
                sys.stderr.write('%d %d %d %d\r' % (
                    month, linecount, len(medallions), len(hacks)))
                sys.stderr.flush()
        sys.stderr.write('%d %d %d %d\n' % (
            month, linecount, len(medallions), len(hacks)))
        sys.stderr.flush()
        medallionTable, hackTable = dehash(medallions.keys(), hacks.keys())
        data = zipfile.ZipFile('trip_data_%d.csv.zip' % month)
        data = csv.reader(data.open(data.namelist()[0]))
        dheader = [getKey(key.strip()) for key in data.next()]
        fare = zipfile.ZipFile('trip_fare_%d.csv.zip' % month)
        fare = csv.reader(fare.open(fare.namelist()[0]))
        fheader = [getKey(key.strip()) for key in fare.next()]
        bulk = collection.initialize_unordered_bulk_op()
        for tripline in data:
            trip = dict(zip(dheader, [val.strip() for val in tripline]))
            trip[getKey('medallion')] = medallionTable.get(
                trip[getKey('medallion')], trip[getKey('medallion')])
            trip[getKey('hack_license')] = hackTable.get(
                trip[getKey('hack_license')], trip[getKey('hack_license')])
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
                fdat[getKey('medallion')] = medallionTable.get(
                    fdat[getKey('medallion')], fdat[getKey('medallion')])
                fdat[getKey('hack_license')] = hackTable.get(
                    fdat[getKey('hack_license')], fdat[getKey('hack_license')])
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
                sys.stderr.write('%d %d %d %d \r' % (
                    month, dcount, rcount, len(triples)))
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
    sys.stderr.write('-- %d %d --\n' % (dcount, rcount))
    sys.stderr.flush()


if __name__ == '__main__':
    help = False
    actions = {}
    opts = {}
    seed = 0
    for arg in sys.argv[1:]:
        if arg.startswith('--collection='):
            CollectionName = arg.split('=', 1)[1]
        elif arg == '--compact':
            KeyTable = CKeyTable
            RevTable = CRevTable
        elif arg == '--dehash':
            actions['dehash'] = True
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

Syntax: load_taxi.py --read --dehash --index --collection=(table)
                     --sample=(rate) --seed=(value) --random
                     --from=(month) --to=(month) --intdate --compact

--collection specifies the collection (table) to use in mongo.  This defaults
    to 'taxi'.
--compact uses extra-compact keys for the database.
--dehash creates collections called 'hacks' and 'medallions' which can be used
    to deanonymize the hack and medallion hashes.
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
        indexTrips()
    if 'read' in actions:
        if seed != '':
            random.seed(int(seed))
        readFiles(opts)
    if 'dehash' in actions:
        dehash()
