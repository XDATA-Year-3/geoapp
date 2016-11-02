#!/usr/bin/python

import datetime
import pymongo
import random
import time


initialIndex = False
outputCollection = 'traffic'
skewRandom = None


def index_collection(coll):
    print 'indexing'
    coll.create_index([('timestamp', pymongo.ASCENDING)])
    coll.create_index([('description', pymongo.ASCENDING)])
    coll.create_index([('_random', pymongo.ASCENDING)])


def status_and_store(dest, data, used, processed, count, users, starttime):
    if len(data):
        dest.insert(data)
        data[:] = []
    curtime = time.time()
    duration = curtime - starttime
    esttime = 0
    if processed and count and processed < count:
        esttime = float(count - processed) * duration / processed
    print '%d/%d/%d %d %3.1f %3.1f' % (
        used, processed, count, len(users), duration, esttime)


starttime = time.time()
epoch = datetime.datetime.utcfromtimestamp(0)
pdtDelta = datetime.timedelta(hours=7)
updateInterval = 2.5
interval = updateInterval

client = pymongo.MongoClient('mongodb://127.0.0.1:27017/pems')
database = client.get_default_database()
source = database['incidents']
print 'dropping'
database.drop_collection(outputCollection)
dest = database[outputCollection]

# Don't index the collection before it is loaded unless you need to use it
# while loading; it slows down loading
if initialIndex:
    index_collection(dest)

cursor = source.find({}, {
    'location': True,
    'description': True,
    'timestamp': True,
    'incident_id': True,
    'location': True,
    'cc_code': True,
    '_id': False
})
processed = used = updatetime = 0
count = cursor.count()
ccs = {}
print 'used/processed/total ccs elapsed(s) left(s)'
data = []
for inc in cursor:
    curtime = time.time()
    if curtime - updatetime > interval:
        status_and_store(dest, data, used, processed, count, ccs, starttime)
        statustime = time.time()
        interval = float(updateInterval) * (curtime - updatetime) / (
            statustime - updatetime)
        updatetime = statustime
    processed += 1
    if not inc.get('description') or not inc.get('location'):
        continue
    inc['latitude'] = inc['location']['coordinates'][1]
    inc['longitude'] = inc['location']['coordinates'][0]
    inc['timestamp'] -= pdtDelta
    inc['random'] = random.random()
    data.append(inc)
    ccs[inc['cc_code']] = True
    used += 1
status_and_store(dest, data, used, processed, count, ccs, starttime)

index_collection(dest)

print 'total time: %3.1f sec' % (time.time() - starttime)
