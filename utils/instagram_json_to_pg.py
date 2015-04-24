import glob
import json
import os
import random
import sys
import tempfile
import time
import zipfile

import fileutil


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


if __name__ == '__main__':
    if len(sys.argv) < 2 or '--help' in sys.argv:
        print """Load instagram data from json files to a Postgres table.

Syntax: load_intsagram.py [--noclear] (json or zip files) > (instagram.pg)

Files must not start with a dash.  Zip files must end with .zip and only files
within the zip file ending with .json are ingested.
--noclear doesn't drop or create the instagram table.
"""
        sys.exit()

    dptr = sys.stdout
    if '--noclear' not in sys.argv[1:]:
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
        'latitude', 'longitude', 'location_id', 'location_name',
        'comment_count', 'comments', 'like_count', 'likes', 'scraped_date'
    ]

    fileData = {'numFiles': 20}
    dptr.write("""
COPY instagram (_id,""")
    dptr.write(','.join(KeyList))
    dptr.write(""") FROM stdin;
""")

    processed = 0
    items = {}
    files = []
    for filespec in sys.argv[1:]:
        if filespec.startswith('-'):
            continue
        for filename in glob.iglob(filespec):
            if filename.lower().endswith('.zip'):
                files.extend(
                    [('zip', filename, subname)
                     for subname in zipfile.ZipFile(filename).namelist()
                     if subname.lower().endswith('.json')])
            else:
                files.append(('file', filename, ''))
    files_processed = 0
    for (filetype, filename, subname) in files:
        if filetype == 'zip':
            fptr = zipfile.ZipFile(filename).open(subname)
            filename += ' - ' + subname
        else:
            fptr = open(filename)
        for record in json.loads(fptr.read())['data']:
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
                key = hash(item)
                if key in items:
                    continue
                items[key] = True
                dataToFiles(fileData, item)
        files_processed += 1
        sys.stderr.write('%3d/%3d %9d %s\n' % (
            files_processed, len(files), len(items), filename[-61:]))

    outputFiles(fileData, dptr)
    dptr.write("""\\.

CREATE INDEX instagram_id_ix ON instagram (_id);
CREATE INDEX instagram_posted_date_ix ON instagram (posted_date);
CREATE INDEX instagram_caption_ix ON instagram USING gin
    (to_tsvector('english', caption));
""")
    sys.stderr.write('\n%d of %d\n' % (len(items), processed))
