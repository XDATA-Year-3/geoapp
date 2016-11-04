#!/usr/bin/python

import datetime
import pymongo
import random
import time


initialIndex = False
outputCollection = 'messages'
skewRandom = None


def index_collection(coll):
    print 'indexing'
    coll.create_index([('msg_date', pymongo.ASCENDING)])
    coll.create_index([('msg', pymongo.ASCENDING)])
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

client = pymongo.MongoClient('mongodb://127.0.0.1:27017/twitter')
database = client.get_default_database()
source = database['dodgertest15mi']
print 'dropping'
database.drop_collection(outputCollection)
dest = database[outputCollection]

# Don't index the collection before it is loaded unless you need to use it
# while loading; it slows down loading
if initialIndex:
    index_collection(dest)

cursor = source.find({}, {
    'created_at': True,
    'text': True,
    'id': True,
    'coordinates': True,
    'place': True,
    'user': True,
    'entities': True,
    'lang': True,
    '_id': False
})
processed = used = updatetime = 0
count = cursor.count()
users = {}
print 'used/processed/total users elapsed(s) left(s)'
data = []
for tweet in cursor:
    curtime = time.time()
    if curtime - updatetime > interval:
        status_and_store(dest, data, used, processed, count, users, starttime)
        statustime = time.time()
        interval = float(updateInterval) * (curtime - updatetime) / (
            statustime - updatetime)
        updatetime = statustime
    processed += 1
    if not tweet.get('text'):
        continue
    msg = {
        'msg_date': tweet['created_at'] - pdtDelta,
        'msg': tweet['text'],
        'msg_id': str(tweet['id']),
        'url': 't/%s/%s' % (str(tweet['user']['id']), str(tweet['id'])),
        'user_id': tweet['user']['screen_name'],
        'user_fullname': tweet['user']['name'],
        'lang': tweet.get('lang'),
        'user_lang': tweet['user'].get('lang'),
        'friends': tweet['user'].get('friends_count', 0),
        'followers': tweet['user'].get('followers_count', 0),
        '_random': random.random(),
    }
    if (tweet.get('coordinates') and tweet['coordinates'].get('coordinates')):
        msg['latitude'] = tweet['coordinates']['coordinates'][1]
        msg['longitude'] = tweet['coordinates']['coordinates'][0]
    elif (tweet.get('place') and tweet['place'].get('bounding_box') and
            tweet['place']['bounding_box'].get('coordinates') and
            len(tweet['place']['bounding_box']['coordinates']) and
            len(tweet['place']['bounding_box']['coordinates'][0]) == 4):
        c = tweet['place']['bounding_box']['coordinates'][0]
        msg['latitude'] = sum([val[1] for val in c]) / len(c)
        msg['longitude'] = sum([val[0] for val in c]) / len(c)
        msg['approx'] = True
    else:
        msg['latitude'] = msg['longitude'] = 0
    if (tweet.get('entities') and tweet['entities'].get('media') and
            len(tweet['entities']['media']) and
            tweet['entities']['media'][0].get('media_url_https')):
        msg['image_url'] = tweet['entities']['media'][0]['media_url_https']
    data.append(msg)
    users[msg['user_id']] = True
    used += 1
status_and_store(dest, data, used, processed, count, users, starttime)

index_collection(dest)

print 'total time: %3.1f sec' % (time.time() - starttime)
