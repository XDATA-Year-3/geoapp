#!/usr/bin/env python

"""
Convert the matches file that is extracted using messages_to_pg to a json
record of matches between twitter and instagram users.

This could potentially find a many-to-many match between users.
"""

import json
import psycopg2
import sys

db = psycopg2.connect(dsn='dbname=msgjuly user=taxi password=taxi#1')
c = db.cursor()

cmdval = 'psql -t -U taxi -c "%s" msgjuly'

if len(sys.argv) >= 2:
    filename = sys.argv[1]
else:
    filename = "c:\\xdata\\july\\allmatches.txt"
matches = [line.split() for line in open(filename).readlines()]
taliases = {}
ialiases = {}
sys.stderr.write('%d\n' % len(matches))
processed = 0
for match in matches:
    processed += 1
    if not processed % 100:
        sys.stderr.write('%d/%d %d %d\r' % (
            processed, len(matches), len(taliases), len(ialiases)))
        sys.stderr.flush()
    twid = match[0]
    iurl = 'i/' + match[1]
    iurl2 = 'https://instagram.com/p/' + match[1]
    sql = ('SELECT user_id from messages where url = \'%s\' or '
           'url = \'%s\';' % (iurl, iurl2))
    c.execute(sql)
    if not c.rowcount:
        continue
    iid = c.fetchone()[0]
    if twid not in taliases:
        # sql = ('SELECT distinct(user_name) from messages where user_id = '
        #        '\'%s\' and service = \'t\'' % twid)
        # c.execute(sql)
        taliases[twid] = {
            'twitter_id': twid,
            # 'twitter_names': [row[0] for row in c.fetchall()],
            'twitter_names': [],
            'instagram_ids': []
        }
    if iid not in ialiases:
        # sql = ('SELECT distinct(user_name) from messages where user_id = '
        #        '\'%s\' and service = \'i\'' % iid)
        # c.execute(sql)
        ialiases[iid] = {
            'instagram_id': iid,
            # 'instagram_names': [row[0] for row in c.fetchall()],
            'instagram_names': [],
            'twitter_ids': []
        }
    if iid not in taliases[twid]['instagram_ids']:
        taliases[twid]['instagram_ids'].append(iid)
    if twid not in ialiases[iid]['twitter_ids']:
        ialiases[iid]['twitter_ids'].append(twid)
    sys.stderr.write('%d/%d %d %d\r' % (
        processed, len(matches), len(taliases), len(ialiases)))
    sys.stderr.flush()
sql = ('SELECT user_id,user_name from messages where user_id in (\'' +
       '\',\''.join(ialiases.keys()) + '\') and service = \'i\' group by '
       'user_id,user_name;')
c.execute(sql)
for row in c:
    ialiases[row[0]]['instagram_names'].append(row[1])

sql = ('SELECT user_id,user_name from messages where user_id in (\'' +
       '\',\''.join(taliases.keys()) + '\') and service = \'t\' group by '
       'user_id,user_name;')
c.execute(sql)
for row in c:
    taliases[row[0]]['twitter_names'].append(row[1])

print json.dumps({'twitter_aliases': taliases, 'instagram_aliases': ialiases})
