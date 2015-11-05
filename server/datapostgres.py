#!/usr/bin/env python
# -*- coding: utf-8 -*-

###############################################################################
#  Copyright Kitware Inc.
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

# This file contains classes and code specific to accessing Postgres databases.

import calendar
import cherrypy
import datetime
import dateutil.parser
import psycopg2
import psycopg2.errorcodes
import re
import time
import threading

from girder import logger

import geoapp


# Per distinct database.  Should be less than 90% of available connections to
# postgres based on its config between all instances of the app that are
# running.  10 is conservative for two databases with a few variations of the
# app hitting the same databases.
PostgresPoolSize = 10


def insertItemIntoPostgres(db, c, item, nodup=True):
    """
    Insert an item record into postgres using the MessageFieldTable format.

    :param db: the database connection.  Needed for commit
    :param c: the database cursor.
    :param item: a dictionary of fields for the item.
    :param nodup: if True, make some effort to avoid duplciates.  This relies
                  on distinct msg_id values.
    :return: True if the data was ingested, false otherwise.
    """
    if not item.get('msg_id', None):
        return False
    if nodup:
        c.execute('SELECT * FROM messages WHERE msg_id = %s LIMIT 1',
                  (item['msg_id'], ))
        if c.rowcount:
            return False
    sql = ['INSERT INTO messages (']
    sqlkeys = []
    sqlvals = []
    sqldata = []
    for key in geoapp.MessageFieldTable:
        if key in item and item[key] is not None:
            sqlkeys.append(key)
            dt = geoapp.MessageFieldTable[key][0]
            if dt in ('date', 'int'):
                sqlvals.append(str(int(item[key])))
            elif dt == 'float':
                sqlvals.append(str(item[key]))
            else:
                sqlvals.append('%s')
                sqldata.append(item[key])
    sql.extend(','.join(sqlkeys))
    sql.append(') VALUES (')
    sql.extend(','.join(sqlvals))
    sql.append(')')
    c.execute(''.join(sql), tuple(sqldata))
    db.commit()
    return True


def tsqueryAddToList(itemList, addArray):
    """
    Add an array of values that should be added together to a list.

    :param itemList: list to append to if there are any values.
    :param andArray: array to combine with &.  If not empty, it is then added
                     to the specified list.
    """
    addval = '&'.join(addArray)
    if not len(addval):
        return
    itemList.append(tsqueryWrapVal(addval))


def tsqueryWrapVal(val):
    """
    Check if a value contains any special characters.  If it does, wrap it
    in parenthesis.

    :param val: value to possible wrap in parenthesis.
    :return: value that has been wrapped as needed.
    """
    if len(re.split('[&|!()]', val, 1)) > 1:
        return '(' + val + ')'
    return val


def tsqueryParse(parts, quotes={}, tsq=None, depth=0):
    """
    Given an array of strings where the elements of the array are either a
    single character with a special token of ( ) ! |, an empty string, or a
    string, produce a tsquery search string.

    :param parts: the array of strings to parse.
    :param quotes: a dictionary of quoted string.  A negated quoted string
                   won't be included in the tsquery to allow excluding phrases
                   with the same lexeme root as a desired lexeme root.
    :param tsq: an optional array of tsquery information.  If present, this
                must have a one-to-one correspondence with the parts array.
                Each entry is either None in indicate that that part has not
                been processed, or a tuple of ((partial tsquery string), (list
                of strings to potentially include exactly), (list of strings to
                potentially exclude exactly).
    :param depth: the depth of the parse tree.  Used for debugging.
    :return: tsquery string.
    :return: number of parts consumed by the parser.
    :return: list of strings to potentially include exactly.
    :return: list of strings to potentially exclude exactly.
    """
    reduced = 0
    if tsq is None:
        tsq = [None] * len(parts)
    include = []
    exclude = []
    while ('(' in parts and (')' not in parts or
                             parts.index('(') < parts.index(')'))):
        pos = parts.index('(')
        subtsq, consume, subinc, subexc = tsqueryParse(
            parts[pos + 1:], quotes, tsq[pos + 1:], depth + 1)
        reduced += len(parts)
        parts[pos:pos + consume + 1] = [None]
        tsq[pos:pos + consume + 1] = [(subtsq, subinc, subexc)]
        reduced -= len(parts)
    consume = len(parts)
    if (')' in parts and ('(' not in parts or
                          parts.index(')') < parts.index('('))):
        parts = parts[:parts.index(')')]
        tsq = tsq[:len(parts)]
        consume = len(parts) + 1
    orlist = []
    curtsq = []
    negate = False
    for pos in xrange(len(parts)):
        if parts[pos] == '|':
            tsqueryAddToList(orlist, curtsq)
            curtsq = []
            negate = False
        elif parts[pos] == '!':
            if pos + 1 < len(parts):
                negate = not negate
        elif tsq[pos] or parts[pos].strip():
            if not tsq[pos]:
                addval = '&'.join(parts[pos].strip().split())
                if negate:
                    exclude.extend(parts[pos].strip().split())
                else:
                    include.extend(parts[pos].strip().split())
            else:
                addval = tsq[pos][0]
                include.extend(tsq[pos][2 if negate else 1])
                exclude.extend(tsq[pos][1 if negate else 2])
            if not negate or addval not in quotes:
                curtsq.append(('!' if negate else '') + tsqueryWrapVal(addval))
            negate = False
    tsqueryAddToList(orlist, curtsq)
    if len(orlist) > 1:
        curtsq = '|'.join(orlist)
        include[:] = []
        exclude[:] = []
    else:
        curtsq = orlist[0]
    return curtsq, consume + reduced, include, exclude


def tsqueryExact(sql, phrases, quotes, field):
    """
    Given a list of phrases, add to an sql query to do a case insensitive
    match if the phrase is either quoted or a hashtag.

    :param sql: an array to append partial sql clauses to.  Modified.
    :param phrase: a list of phrases to consider adding.  These are either
                   keys in the quotes dictionary, in which case they are
                   included, or plain strings, in which case they are only
                   included if they start with #.
    :param quotes: a dictionary of quotes.
    :param field: name of the field to query.
    """
    for phrase in set(phrases):
        if phrase in quotes:
            escval = re.escape(quotes[phrase])
            escval = psycopg2.extensions.adapt(escval).getquoted()[1:-1]
            sql.append(' AND ' + field + ' ~* E\'' + escval + '\'')
        elif phrase.startswith('#') and len(phrase) > 1:
            escval = re.escape(phrase)
            escval = psycopg2.extensions.adapt(escval).getquoted()[1:-1]
            sql.append(' AND ' + field + ' ~* E\'(^|[^\\w#])' + escval +
                       '($|[^\\w#])\'')


def tsquerySearch(field, query):
    """
    Convert a string query into a Postgres tsquery.  Quoted sections require
    an exact case-insensitive match, as do #(hashtag) phrases.  All words are
    required.  There is limited support for grouping with ( ), exclusion with
    - or !, logical or of phrases with |, and using & or + for and (the same
    as with a space).  Currently, negating something that contains a quoted
    phrase or hashtag probably won't work.

    :param field: name of the field to query.
    :param query: the original text string.
    :returns: a sql where clause with '%s' whereever a string that needs to be
              escaped is located.
    :returns: an array of strings that are needed for the sql where clause.
    """
    sql = ['to_tsvector(\'english\', %s) @@ to_tsquery(\'english\', ' % field]
    sqlval = []
    sql.append('%s')

    quotedparts = query.replace('\x01', ' ').strip().split('"')
    quotes = {}
    for pos in xrange(1, len(quotedparts), 2):
        if len(quotedparts[pos]):
            quotekey = '\x01' + unichr(len(quotes) + 256)
            quotes[quotekey] = quotedparts[pos]
            quotedparts[pos] = quotekey
    processedQuery = ''.join(quotedparts)
    processedQuery = processedQuery.replace('+', ' ').replace(
        '&', ' ').replace(':', ' ').replace('-', '!').strip()
    parts = [part.strip() for part in re.split('([|()!\- ])', processedQuery)]
    tsq, _, include, exclude = tsqueryParse(parts, quotes)
    for key in quotes:
        tsq = tsq.replace(key, tsqueryWrapVal('&'.join((' '.join(
            re.split('- !()|&+:', quotes[key])).strip()).split())))
    sqlval.append(tsq)
    sql.append(')')
    if len(include):
        tsqueryExact(sql, include, quotes, field)
    if len(exclude):
        subsql = []
        tsqueryExact(subsql, exclude, quotes, field)
        if len(subsql):
            sql.extend([' AND NOT (true' + subsqlval + ')' for subsqlval in
                        subsql])
    return ''.join(sql), sqlval


class ViaPostgres():

    epoch = datetime.datetime.utcfromtimestamp(0)

    def __init__(self, db=None, **params):
        self.dbname = db
        self.dbparams = params.copy()
        self.dbLock = threading.RLock()
        self.dbpool = []
        self.maxPoolSize = PostgresPoolSize
        if db is not None:
            self.dbparams['database'] = db
        if not self.dbparams['database'] and not self.dbparams['dsn']:
            self.dbparams['dsn'] = 'parakon:taxi12r:taxi:taxi#1'
        self.useMilliseconds = False
        self.alwaysUseIdSort = True
        self.defaultSort = [('_id', 1)]
        self.maxId = None
        self.realtime = False
        self.dbIdleTime = 300
        self.dbAbandonTime = self.dbIdleTime * 5
        self.closeThread = threading.Thread(target=self.closeWhenIdle)
        self.closeThread.daemon = True
        self.closeThread.start()

    def adjustReturnFields(self, fields):
        """
        If the database is using seconds (not milliseconds) for dates, convert
        the output dates into milliseconds, since we expect the results to be
        used by javascript.

        :param fields: the table keys used to query Postgres.
        :return fields: the converted keys, as necessary.
        """
        if self.useMilliseconds is True:
            return fields
        newfields = []
        for field in fields:
            if (field in self.fieldTable and
                    self.fieldTable[field][0] == 'date'):
                if self.useMilliseconds:
                    newfields.append(field + ' + %d::bigint' % (
                        self.useMilliseconds * 1000))
                else:
                    newfields.append(field + ' * 1000::bigint')
            else:
                newfields.append(field)
        return newfields

    def connect(self, reconnect=False, client=None):
        """
        Connect to the database.

        :param reconnect: if False, allow an open connection to be returned.
                          If 'fresh', create a new connection that the caller
                          is responsible for closing that isn't part of the
                          pool.  The client is ignored in this case.  If True,
                          close any existing connections that aren't in use or
                          are for this client, and return a new connection.
        :param client: if None, use the next connection in the pool.  If
                       specified, if this client is currently marked in use,
                       cancel the client's existing query and return a
                       connection from the pool for the client to use.
        :return: a database object.
        """
        if reconnect == 'fresh':
            return psycopg2.connect(**self.dbparams)
        db = None
        with self.dbLock:
            if client:
                for pos in range(len(self.dbpool) - 1, -1, -1):
                    if self.dbpool[pos].get('client', None) == client:
                        self.dbpool[pos]['db'].cancel()
                        if reconnect:
                            self.dbpool[pos:pos + 1] = []
                        else:
                            self.dbpool[pos]['used'] = False
                            self.dbpool[pos]['client'] = None
            if reconnect:
                if len(self.dbpool) >= self.maxPoolSize:
                    for pos in range(len(self.dbpool)):
                        if not self.dbpool[pos]['used']:
                            self.dbpool[pos]['db'].close()
                            self.dbpool[pos:pos + 1] = []
                            break
            if not reconnect:
                for pos in range(len(self.dbpool)):
                    if not self.dbpool[pos]['used']:
                        db = self.dbpool[pos]['db']
                        self.dbpool[pos]['used'] = True
                        self.dbpool[pos]['client'] = client
                        self.dbpool[pos]['time'] = time.time()
                        break
            if not db:
                db = psycopg2.connect(**self.dbparams)
                self.dbpool.append({
                    'db': db,
                    'used': True,
                    'client': client,
                    'time': time.time()
                })
        return db

    def closeWhenIdle(self):
        """
        Periodically check if the database has been used.  If not, close the
        connection to free resources and allow easier management of the
        database while the application is running.
        """
        while True:
            with self.dbLock:
                curtime = time.time()
                for pos in range(len(self.dbpool) - 1, -1, -1):
                    delta = curtime - self.dbpool[pos]['time']
                    if ((not self.dbpool[pos]['used'] and
                            delta > self.dbIdleTime) or
                            delta > self.dbAbandonTime):
                        # The old db connection will close when no process is
                        # using it
                        self.dbpool[pos:pos + 1] = []
            time.sleep(30)

    def checkMaxId(self, client=None):
        """
        Check the max ID for this table.  This can be reported with the results
        to aid in determining what percentage of the total data was retreived.

        :param client: the clientid to use for the database connection.
        """
        if self.maxId is None and self.queryBase in ('instagram', 'taxi'):
            db = self.connect(client=client)
            c = db.cursor()
            try:
                c.execute('SELECT max(_id) FROM %s' % self.tableName)
                row = c.fetchone()
                self.maxId = int(row[0])
            except (psycopg2.Error, ValueError):
                self.maxId = 0
            c.close()
            self.disconnect(db, client)

    def disconnect(self, db, client=None):
        """
        Mark that a client has finished with a database connection and it can
        be closed or returned to the pool.

        :param db: the database connection to mark as finished.
        :param client: the client that owned this connection.
        """
        with self.dbLock:
            for pos in range(len(self.dbpool)):
                if self.dbpool[pos]['db'] == db:
                    self.dbpool[pos]['used'] = False
                    self.dbpool[pos]['client'] = None
                    if len(self.dbpool) > self.maxPoolSize:
                        self.dbpool[pos:pos + 1] = []
                    break

    def find(self, params={}, limit=50, offset=0, sort=None, fields=None,
             **kwargs):
        """
        Get data from a postgres database.

        :param params: a dictionary of query restrictions.  See the field
                       table(s).  For values that aren't of type 'text' or
                       'search', we also support (field)_min and (field)_max
                       parameters, which are inclusive and exclusive
                       respectively.  'search' adds a (field)_search parameter
                       which will perform a tsquery search.
        :param limit: default limit for the data.
        :param offset: default offset for the data.
        :param sort: a tuple of the form (key, direction).  Not currently
                     supported.
        :param fields: a list of fields to return, or None for all fields.
        :param queryBase: a string used to ensure we are using keys appropriate
                          to the asking query and to underlying database.
        :param whereClauses: a list of extra where clauses that are anded to
                             any other where clauses.
        :returns: a dictionary of results.
        """
        client = params.get('clientid', '').strip()
        if not client:
            client = None
        starttime = time.time()
        self.checkMaxId(client)
        if sort is None or self.alwaysUseIdSort:
            # shuffled order
            sort = self.defaultSort
        sql = ['SELECT']
        queryToDbKeys, dbToQueryKeys = self.getKeyTables(
            kwargs.get('queryBase', None))
        if not fields:
            fields = [field[0] for field in self.fieldTable]
        fields = [field for field in fields if
                  queryToDbKeys.get(field, field) is not None]
        dbfields = [queryToDbKeys.get(field, field) for field in fields]
        if hasattr(self, 'adjustReturnFields'):
            sql.append(','.join(self.adjustReturnFields(dbfields)))
        else:
            sql.append(','.join(dbfields))
        sql.append('FROM %s WHERE true' % self.tableName)
        if kwargs.get('whereClauses', None) and len(kwargs['whereClauses']):
            sql.extend(['AND', ' AND '.join(kwargs['whereClauses'])])
        sqlval = []
        self.params_to_sql(params, sql, sqlval, dbToQueryKeys)

        self.findModifiers(sort, limit, offset, sql, queryToDbKeys)
        sql = ' '.join(sql)
        columns = {fields[col]: col for col in xrange(len(fields))}
        result = {
            'format': 'list',
            'fields': fields,
            'columns': columns
        }
        if self.maxId:
            result['maxid'] = self.maxId
        db, c = self.findQuery(result, params, sql, sqlval, client)
        if not db:
            return
        execTime = None
        if c:
            execTime = time.time()
            try:
                result['data'] = data = c.fetchmany()
                while data:
                    data = c.fetchmany()
                    if data:
                        result['data'].extend(data)
                c.close()
            except psycopg2.Error as exc:
                code = psycopg2.errorcodes.lookup(exc.pgcode)
                logger.info('Database error %s - %s', str(exc).strip(), code)
        self.disconnect(db, client)
        if execTime:
            curtime = time.time()
            logger.info(
                'Query time: %5.3fs for query, %5.3fs total, %d row%s',
                execTime - starttime, curtime - starttime, len(result['data']),
                's' if len(result['data']) != 1 else '')
        return result

    def findModifiers(self, sort, limit, offset, sql, queryToDbKeys={}):
        """
        Add sort, limit, and offsets to the sql query.

        :param sort: the requested sort order.  This is a list of tuples,
                     where the first item of each tuple is a query key and the
                     seconds is -1 for descending or anything else for
                     ascending.
        :param limit: optional limit.
        :param offset: optional offset.
        :param sql: list of sql phrases.  Modified.
        :param queryToDbKeys: a map to convert query parameters to database
                              parameters.
        """
        if sort:
            sql.append('ORDER BY')
            sorts = []
            for sortval in sort:
                if queryToDbKeys.get(sortval[0], sortval[0]) is None:
                    continue
                if queryToDbKeys.get(sortval[0], None):
                    sortstr = queryToDbKeys[sortval[0]]
                else:
                    sortstr = '%s' % sortval[0]
                if sortval[1] == -1:
                    sortstr += ' DESC'
                sorts.append(sortstr)
            if len(sorts):
                sql.append(','.join(sorts))
            else:
                sql[-1:] = []
        if limit:
            sql.append('LIMIT %d' % limit)
        if offset:
            sql.append('OFFSET %d' % offset)

    def findQuery(self, result, params, sql, sqlval, client=None):
        """
        Perform the find query with a retry loop.

        :param result: dictionary with some result information.
        :param params: rest query parameters.
        :param sql: sql to execute.
        :param sqlval: values to pass to sql execute.
        :param client: client for database access.
        :returns: the database connection and the database cursor with the
                  query results.
        """
        maxretry = 3
        for retry in xrange(maxretry):
            db = None
            try:
                db = self.connect(retry != 0, client)
                c = db.cursor()
                if params.get('_id_max', None):
                    result['nextId'] = params['_id_max']
                elif self.queryBase == 'message' and self.realtime:
                    c.execute('SELECT max(_id) + 1 FROM %s' % self.tableName)
                    row = c.fetchone()
                    # We use this to guarantee that we don't get newer data than
                    # what we first saw.
                    result['nextId'] = row[0] if row[0] else 0
                    if str(result['nextId']) == params.get('_id_min', None):
                        result['data'] = []
                        c.close()
                        return db, None
                    sql = sql.replace(' WHERE true', ' WHERE _id<%s' % str(
                        result['nextId']))
                logger.info('Query: %s', c.mogrify(sql, sqlval))
                c.execute(sql, sqlval)
                break
            except psycopg2.Error as exc:
                if db:
                    self.disconnect(db, client)
                try:
                    code = psycopg2.errorcodes.lookup(exc.pgcode)
                except KeyError:
                    code = '%s' % exc.pgcode
                logger.info('Database error %s - %s', str(exc).strip(), code)
                if retry + 1 == maxretry or code == 'QUERY_CANCELED':
                    cherrypy.response.status = 500
                    return None, None
        return db, c

    def getKeyTables(self, queryBase):
        """
        Get conversion key tables if the queryBase of this class is not the
        same as the queryBase of the rest endpoint.

        :param queryBase: queryBase of the rest endpoint.
        :returns: dictionaries to convert between the rest end point and the
                  db and between the db and the rest end point.
        """
        queryToDbKeys = dbToQueryKeys = {}
        if self.queryBase == 'instagram' and queryBase == 'message':
            queryToDbKeys = geoapp.MsgToInstKeyTable
            dbToQueryKeys = geoapp.InstToMsgKeyTable
        if self.queryBase == 'message' and queryBase == 'instagram':
            queryToDbKeys = geoapp.InstToMsgKeyTable
            dbToQueryKeys = geoapp.MsgToInstKeyTable
        return queryToDbKeys, dbToQueryKeys

    def ingestTwitter(self, db, c, data, ingestFrom=None, nodup=False):
        """
        Injest an object from Twitter.

        :param db: database object.  Use for committing the chanegs.
        :param c: database cursor: Used for adding the data.
        :param data: a data dictionary as produced by Twitter.
        :param ingestFrom: optional name of the ingest source.
        :param nodup: if True, make some effort to avoid duplciates.  This
                      relies on distinct msg_id values.
        :return: True if the data was ingested, false otherwise.
        """
        if 'timestamp_ms' in data:
            date = int(data['timestamp_ms'])
        elif 'created_at' in data:
            date = int(calendar.timegm(dateutil.parser.parse(
                data['created_at']).utctimetuple()) * 1000)
        else:
            return False
        item = {
            'msg_id': data['id_str'],
            'user_id': data['user']['id_str'],
            'user_name': data['user']['name'],
            'msg_date': int(date / 1000),
            'msg_date_ms': date,
            'url': 't/%s/%s' % (data['user']['id_str'], data['id_str']),
            'msg': self.decoder.unescape(data['text']),
            'utc_offset': data['user']['utc_offset'],
            'ingest_date': time.time()
        }
        if ('entities' in data and 'media' in data['entities'] and
                len(data['entities']['media']) > 0 and
                'media_url_https' in data['entities']['media'][0]):
            item['image_url'] = data['entities']['media'][0][
                'media_url_https']
        if ('coordinates' in data and data['coordinates'] and
                'coordinates' in data['coordinates'] and
                len(data['coordinates']['coordinates']) >= 2):
            item['latitude'] = data['coordinates']['coordinates'][1]
            item['longitude'] = data['coordinates']['coordinates'][0]
        if ('place' in data and data['place'] and 'id' in data['place'] and
                'name' in data['place']):
            item['location_id'] = data['place']['id']
            item['location_name'] = data['place']['name']
        else:
            # if we don't have a location id or coordinates, give up
            if 'latitude' not in item:
                return False
        if ('source' in data and 'Instagram' in data['source'] and
                'entities' in data and 'urls' in data['entities'] and
                len(data['entities']['urls']) >= 1 and
                'display_url' in data['entities']['urls'][0] and
                'instagram' in data['entities']['urls'][0]['display_url']):
            item['source'] = self.decoder.unescape(
                data['entities']['urls'][0]['display_url'])
        if ingestFrom:
            item['ingest_source'] = ingestFrom
        return insertItemIntoPostgres(db, c, item, nodup)

    def params_to_sql(self, params, sql, sqlval, altkeys={}):
        """
        Convert params to sql.

        :param params: a dictionary of query restrictions.
        :param sql: a list of sql statement fragments.  Modified.
        :param sqlval: a list of sql values to escape.  Modified.
        :param altkeys: a dictionary of alternate names for keys.  Each key is
                        a database key name, and the values are the query key
                        names.  This can be used to convert db parameters to
                        query parameters.
        """
        for field in self.fieldTable:
            for comp, suffix in [('=', ''), ('>=', '_min'), ('<', '_max'),
                                 ('search', '_search')]:
                if (altkeys.get(field, None) is not None and
                        altkeys[field] + suffix in params):
                    value = params[altkeys[field] + suffix]
                else:
                    if field + suffix not in params:
                        continue
                    value = params[field + suffix]
                dtype = self.fieldTable[field][0]
                if comp == 'search':
                    if dtype != 'search':
                        continue
                    if isinstance(value, (int, float, long)):
                        value = str(value)
                    subsql, subvalues = tsquerySearch(field, value)
                    sql.append('AND ' + subsql)
                    sqlval.extend(subvalues)
                elif dtype == 'date':
                    value = int((dateutil.parser.parse(value) - self.epoch)
                                .total_seconds())
                    if self.useMilliseconds is True:
                        value *= 1000
                    elif self.useMilliseconds:
                        value = (value - self.useMilliseconds) * 1000
                    sql.append('AND ' + field + comp + '%d' % value)
                elif dtype in ('int', 'bigint'):
                    value = int(value)
                    sql.append('AND ' + field + comp + '%d' % value)
                elif dtype == 'float':
                    value = float(value)
                    sql.append('AND ' + field + comp + '%f' % value)
                elif dtype == 'commalist' and ',' in str(value) and not suffix:
                    value = str(value).split(',')
                    sql.append('AND ' + field + ' IN (%s' +
                               ',%s' * (len(value) - 1) + ')')
                    sqlval.extend(value)
                else:
                    value = str(value)
                    sql.append('AND ' + field + comp + '%s')
                    sqlval.append(value)
