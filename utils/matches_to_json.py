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

matches = [line.split() for line in open(
    "c:\\xdata\\july\\allmatches.txt").readlines()]
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
    sql = 'SELECT user_id from messages where url = \'%s\'' % iurl
    c.execute(sql)
    if not c.rowcount:
        continue
    iid = c.fetchone()[0]
    if twid not in taliases:
        sql = ('SELECT distinct(user_name) from messages where user_id = '
               '\'%s\' and service = \'t\'' % twid)
        c.execute(sql)
        taliases[twid] = {
            'twitter_id': twid,
            'twitter_names': [row[0] for row in c.fetchall()],
            'instagram_ids': []
        }
    if iid not in ialiases:
        sql = ('SELECT distinct(user_name) from messages where user_id = '
               '\'%s\' and service = \'i\'' % iid)
        c.execute(sql)
        if not c.rowcount:
            continue
        ialiases[iid] = {
            'instagram_id': iid,
            'instagram_names': [row[0] for row in c.fetchall()],
            'twitter_ids': []
        }
    if iid not in taliases[twid]['instagram_ids']:
        taliases[twid]['instagram_ids'].append(iid)
    if twid not in ialiases[iid]['twitter_ids']:
        ialiases[iid]['twitter_ids'].append(twid)
    sys.stderr.write('%d/%d %d %d\r' % (
        processed, len(matches), len(taliases), len(ialiases)))
    sys.stderr.flush()
print json.dumps({'twitter_aliases': taliases, 'instagram_aliases': ialiases})
