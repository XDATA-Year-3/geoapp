#!/usr/bin/python

import datetime
import pymongo
import random
import time


initialIndex = False
outputCollection = 'flow'
partial = 0.01


def index_collection(coll):
    print 'indexing'
    coll.create_index([('time_pdt', pymongo.ASCENDING)])
    coll.create_index([('_random', pymongo.ASCENDING)])
    coll.create_index([('station_id', pymongo.ASCENDING)])


def status_and_store(dest, data, used, processed, count, stations, starttime):
    if len(data):
        dest.insert(data)
        data[:] = []
    curtime = time.time()
    duration = curtime - starttime
    esttime = 0
    if processed and count and processed < count:
        esttime = float(count - processed) * duration / processed
    print '%d/%d/%d %d %3.1f %3.1f' % (
        used, processed, count, len(stations), duration, esttime)


starttime = time.time()
epoch = datetime.datetime.utcfromtimestamp(0)
pdtDelta = datetime.timedelta(hours=7)
updateInterval = 2.5
interval = updateInterval

client = pymongo.MongoClient('mongodb://127.0.0.1:27017/pems')
database = client.get_default_database()
source = database['stationdata']
print 'dropping'
database.drop_collection(outputCollection)
dest = database[outputCollection]

# Don't index the collection before it is loaded unless you need to use it
# while loading; it slows down loading
if initialIndex:
    index_collection(dest)

cursor = source.find({}, {
    'timestamp': True,
    'location': True,
    'station_id': True,
    'avg_occupancy': True,
    'total_flow': True,
    'avg_speed': True,
    '_id': False
}, sort=[('station_id', 1)])
processed = used = updatetime = 0
count = cursor.count()
stations = {}
print 'used/processed/total stations elapsed(s) left(s)'
data = []
for point in cursor:
    curtime = time.time()
    if curtime - updatetime > interval or len(data) > 1000000:
        status_and_store(dest, data, used, processed, count, stations,
                         starttime)
        statustime = time.time()
        interval = float(updateInterval) * (curtime - updatetime) / (
            statustime - updatetime)
        updatetime = statustime
    processed += 1
    if (not point.get('avg_occupancy') or
            not point.get('location') or
            not point['location'].get('coordinates')):
        continue
    if not point.get('total_flow'):
        continue
    point['latitude'] = point['location']['coordinates'][1]
    point['longitude'] = point['location']['coordinates'][0]
    point['time_pdt'] = point['timestamp'] - pdtDelta
    try:
        for flow in xrange(point['total_flow']):
            if partial and partial != 1:
                if random.random() > partial:
                    continue
            data.append({
                'time_pdt': point['time_pdt'],
                'latitude': point['latitude'],
                'longitude': point['longitude'],
                'station_id': point['station_id'],
                'avg_occupancy': point['avg_occupancy'],
                '_random': random.random() * (partial if partial else 1),
            })
            for key in ('avg_speed', ):
                if key in point:
                    data[-1][key] = point[key]
    except Exception:
        print point
        raise
    stations[point['station_id']] = True
    used += 1
status_and_store(dest, data, used, processed, count, stations, starttime)

index_collection(dest)

print 'total time: %3.1f sec' % (time.time() - starttime)
