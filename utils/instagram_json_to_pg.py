import glob
import json
import random
import sys

if len(sys.argv) < 2 or '--help' in sys.argv:
    print """Load instagram data from json files to a Postgres table.

Syntax: load_intsagram.py [--clear] (json files) > (instagram.pg)"""
    sys.exit()

dptr = sys.stdout
if '--clear' in sys.argv[1:]:
    dptr.write("""DROP TABLE instagram;

CREATE TABLE instagram (
    user_name text,
    user_id_num int,
    posted_date int,
    image_url text,
    caption text,
    latitude double precision,
    longitude double precision,
    location_id text,
    location_name text,
    comment_count int,
    comments text,
    like_count int,
    likes text,
    scraped_date int,
    _id serial
);
""")

KeyList = [
    'user_name', 'user_id_num', 'posted_date', 'image_url', 'caption',
    'latitude', 'longitude', 'location_id', 'location_name', 'comment_count',
    'comments', 'like_count', 'likes', 'scraped_date'
]

dptr.write("""
COPY instagram (_id,""")
dptr.write(','.join(KeyList))
dptr.write(""") FROM stdin;
""")

processed = 0
items = {}
for filespec in sys.argv[1:]:
    if filespec.startswith('-'):
        continue
    for filename in glob.iglob(filespec):
        for record in json.loads(open(filename).read())['data']:
            for inst in record['data']:
                processed += 1
                if not inst.get('location', None):
                    continue
                if ('latitude' not in inst['location'] or
                        'longitude' not in inst['location']):
                    continue
                item = {
                    'user_name':      inst['user']['username'],
                    'user_id_number': inst['user']['id'],
                    'posted_date':    inst['created_time'],
                    'image_url':      inst['link'],
                    'latitude':       inst['location']['latitude'],
                    'longitude':      inst['location']['longitude'],
                    'comment_count':  inst['comments']['count'],
                    'comments':       '',
                    'like_count':     inst['likes']['count'],
                    'likes':          '',
                }
                if inst['caption']:
                    item['caption'] = inst['caption']['text']
                if 'id' in inst['location']:
                    item['location_id'] = inst['location']['id']
                if 'name' in inst['location']:
                    item['location_name'] = inst['location']['name']
                if 'data' in inst['comments']:
                    item['comments'] = '|'.join(['%s;%s;%s;%s' % (
                        comm['from']['username'], comm['from']['id'],
                        comm['created_time'], comm['text']
                    ) for comm in inst['comments']['data']])
                if 'data' in inst['likes']:
                    item['likes'] = '|'.join(['%s;%s' % (
                        like['username'], like['id']
                    ) for like in inst['likes']['data']])
                item = [item.get(key, None) for key in KeyList]
                item = ['\\N' if col is None else unicode(col).replace(
                    '\t', ' ').replace('\r', ' ').replace('\n', ' ').replace(
                    '\v', ' ').replace('\f', ' ').replace('\b', ' ').replace(
                    '\\', '\\\\') for col in item]
                item = '\t'.join(item)
                items[item] = True
        sys.stderr.write('%d %s\n' % (len(items), filename))
items = items.keys()
random.shuffle(items)
for id in xrange(len(items)):
    dptr.write(('%d\t%s\n' % (id, items[id])).encode('utf8'))
dptr.write("""\\.

CREATE INDEX instagram_id_ix ON instagram (_id);
CREATE INDEX instagram_posted_date_ix ON instagram (posted_date);
CREATE INDEX instagram_caption_ix ON instagram USING gin
    (to_tsvector('english', caption));
""")
sys.stderr.write('%d of %d\n' % (len(items), processed))
