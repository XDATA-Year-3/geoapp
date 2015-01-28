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
import sys
import zipfile


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
}

RevTable = {v: k for k, v in KeyTable.items()}


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
    dbUri = 'mongodb://localhost:27017/taxi'
    return pymongo.MongoClient(dbUri, **clientOptions)


def getKey(key):
    return KeyTable.get(key, key)


def indexTrips():
    """
    Drop and then create indices on the trips collection.
    """
    client = getDbConnection()
    database = client.get_default_database()
    collection = database['trips']
    collection.drop_indexes()
    collection.ensure_index(
        [(getKey('medallion'), 1), (getKey('hack_license'), 1),
         (getKey('pickup_datetime'), 1)], background=True)
    collection.ensure_index([(getKey('medallion'), 1)], background=True)
    collection.ensure_index([(getKey('hack_license'), 1)], background=True)
    collection.ensure_index([(getKey('pickup_datetime'), 1)], background=True)


def readFiles(sampleRate=None, uniqueTrips=False):
    """
    Read the taxi data from files in the local directory that are named
    trip_(data|fare)_{month}.csv.zip and store the data in the 'trips'
    collection of a mongo database at mongodb://localhost:27017/taxi.  Any
    existing trips collection is dropped.

    :param sampleRate: if a number, only keep a statistical average of 1 row in
                       this many.
    :param uniqueTrips: True to enforce (medallion, hack_license,
                        pickup_datetime) tuple uniqueness.
    """
    client = getDbConnection()
    database = client.get_default_database()
    collection = database['trips']
    collection.drop()
    indexTrips()
    dcount = rcount = 0
    usedkeys = {}
    for month in xrange(1, 13):
        data = zipfile.ZipFile('trip_data_%d.csv.zip' % month)
        data = csv.reader(data.open(data.namelist()[0]))
        dheader = [getKey(key.strip()) for key in data.next()]
        medallions = {}
        hacks = {}
        triples = {}
        linecount = 0
        for tripline in data:
            trip = dict(zip(dheader, [val.strip() for val in tripline]))
            medallions[trip['med']] = True
            hacks[trip['hack']] = True
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
            trip['med'] = medallionTable.get(trip['med'], trip['med'])
            trip['hack'] = hackTable.get(trip['hack'], trip['hack'])
            tripkey = (trip['med'], trip['hack'], trip['pdate'])
            if (trip['med'] in usedkeys and
                    trip['hack'] in usedkeys[trip['med']] and
                    trip['pdate'] in usedkeys[trip['med']][trip['hack']]):
                continue
            while tripkey not in triples:
                fareline = fare.next()
                if not fareline:
                    break
                fdat = dict(zip(fheader, [val.strip() for val in fareline]))
                fdat['med'] = medallionTable.get(fdat['med'], fdat['med'])
                fdat['hack'] = hackTable.get(fdat['hack'], fdat['hack'])
                fdatkey = (fdat['med'], fdat['hack'], fdat['pdate'])
                triples[fdatkey] = fdat
            if tripkey not in triples:
                continue
            trip.update(triples[tripkey])
            del triples[tripkey]
            if uniqueTrips:
                usedkeys.default(trip['med'], {}).default(
                    trip['hack'], {})[trip['pdate']] = True
            
            rcount += 1
            if sampleRate and random.random() * sampleRate >= 1:
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
                        elif dataType == 'float':
                            trip[key] = float(trip[key])
                        elif dataType == 'int':
                            trip[key] = int(trip[key])
                    except ValueError:
                        print 'ValueError', TypeTable[key], key, trip[key]
                        sys.exit(0)
            bulk.insert(trip)
            dcount += 1
            if not dcount % 1000:
                sys.stderr.write('%d %d %d %d \r' % (
                    month, dcount, rcount, len(triples)))
                sys.stderr.flush()
                bulk.execute()
                bulk = collection.initialize_unordered_bulk_op()
        bulk.execute()
        data = None
    sys.stderr.write('-- %d %d --\n' % (dcount, rcount))
    sys.stderr.flush()


if __name__ == '__main__':
    help = False
    actions = {}
    seed = 0
    sampleRate = None
    for arg in sys.argv[1:]:
        if arg == '--dehash':
            actions['dehash'] = True
        elif arg == '--index':
            actions['index'] = True
        elif arg == '--read':
            actions['read'] = True
        elif arg.startswith('--sample='):
            sampleRate = float(arg.split('=', 1)[1])
        elif arg.startswith('--seed='):
            seed = arg.split('=', 1)[1]
        else:
            help = True
    if help or not len(actions):
        print """Load taxi zip files into a mongo database.

Syntax: load_taxi.py --read --dehash --index
                     --sample=(rate) --seed=(value)

--read drops the 'trips' collection at mongodb://localhost:27017/taxi and reads
    it in from files in the local directory that are named
    trip_(data|fare)_{month}.csv.zip.
--dehash creates collections called 'hacks' and 'medallions' which can be used
    to deanonymize the hack and medallion hashes.
--index regenerates indices on the 'trips' collection.
--sample picks a subset of rows.  Statistically, 1 row in (rate) is selected.
    The random seed affects which rows are selected.
--seed specifies a random number seed.  Default is 0.  Blank for no explicit
    seed."""
        sys.exit(0)
    if 'read' in actions:
        if seed != '':
            random.seed(int(seed))
        readFiles(sampleRate)
    if 'index' in actions:
        indexTrips()
    if 'dehash' in actions:
        dehash()
