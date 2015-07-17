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

# This file exposes endpoints to get taxi and other geoapp data.

import binascii
import calendar
import cherrypy
import collections
import datetime
import dateutil.parser
import HTMLParser
import json
import psycopg2
import psycopg2.errorcodes
import pymongo
import re
import time
import threading
import urllib

import girder.api.rest
from girder import logger
from girder.api import access
from girder.constants import AccessType
from girder.api.describe import Description
from girder.api.rest import RestException


# Per distinct database.  Should be less than 90% of available connections to
# postgres based on its config between all instances of the app that are
# running.  10 is conservative for two databases with a few variations of the
# app hitting the same databases.
PostgresPoolSize = 10


GeoappUser = {
    'login': 'geoapp',
    'password': 'geoapp#1',
    'firstName': 'geoapp',
    'lastName': 'geoapp',
    'email': 'noemail@noemail.com',
    'admin': False
}


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
    for key in MessageFieldTable:
        if key in item and item[key] is not None:
            sqlkeys.append(key)
            dt = MessageFieldTable[key][0]
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
        curtime = time.time()
        logger.info(
            'Query time: %5.3fs for query, %5.3fs total, %d row%s',
            execTime - starttime, curtime - starttime, len(result['data']),
            's' if len(result['data']) != 1 else '')
        return result

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
            try:
                db = self.connect(retry != 0, client)
                c = db.cursor()
                if self.queryBase == 'message' and self.realtime:
                    c.execute('SELECT max(_id) + 1 FROM %s' % self.tableName)
                    row = c.fetchone()
                    # We use this to guarantee that we don't get newer data than
                    # what we first saw.
                    result['nextId'] = row[0] if row[0] else 0
                    if str(result['nextId']) == params.get('_id_min'):
                        result['data'] = []
                        c.close()
                        return result
                    sql = sql.replace(' WHERE true', ' WHERE _id<%s' % str(
                        result['nextId']))
                logger.info('Query: %s', c.mogrify(sql, sqlval))
                c.execute(sql, sqlval)
                break
            except psycopg2.Error as exc:
                self.disconnect(db, client)
                code = psycopg2.errorcodes.lookup(exc.pgcode)
                logger.info('Database error %s - %s', str(exc).strip(), code)
                if retry + 1 == maxretry or code == 'QUERY_CANCELED':
                    cherrypy.response.status = 500
                    return None, None
        return db, c

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
            queryToDbKeys, dbToQueryKeys = MsgToInstKeyTable, InstToMsgKeyTable
        if self.queryBase == 'message' and queryBase == 'instagram':
            queryToDbKeys, dbToQueryKeys = InstToMsgKeyTable, MsgToInstKeyTable
        return queryToDbKeys, dbToQueryKeys

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
                else:
                    value = str(value)
                    sql.append('AND ' + field + comp + '%s')
                    sqlval.append(value)


# -------- TAXI specific classes and code --------

TaxiFieldTable = collections.OrderedDict([
    ('medallion', ('text', 'Taxi medallion')),
    ('hack_license', ('text', 'Hack license number')),
    ('vendor_id', ('text', 'Vendor ID')),
    ('store_and_fwd_flag', ('text', 'Store and forward flag')),
    ('payment_type', ('text', 'Payment type')),

    ('dropoff_datetime', ('date', 'Dropoff date')),
    ('dropoff_latitude', ('float', 'Dropoff latitude')),
    ('dropoff_longitude', ('float', 'Dropoff longitude')),
    ('passenger_count', ('int', 'Passenger count')),
    ('pickup_datetime', ('date', 'Pickup date')),
    ('pickup_latitude', ('float', 'Pickup latitude')),
    ('pickup_longitude', ('float', 'Pickup longitude')),
    ('rate_code', ('int', 'Rate code')),
    ('trip_distance', ('float', 'Trip distance (miles)')),
    ('trip_time_in_secs', ('int', 'Time time (seconds)')),

    ('fare_amount', ('float', 'Fare amount')),
    ('mta_tax', ('float', 'MTA tax')),
    ('surcharge', ('float', 'Surcharge')),
    ('tip_amount', ('float', 'Tip amount')),
    ('tolls_amount', ('float', 'Tolls')),
    ('total_amount', ('float', 'Total cost')),
])
TaxiFieldTableRand = collections.OrderedDict(TaxiFieldTable.items() + [
    ('ingest_source',     ('text',   'Ingest Source')),
    ('service',           ('text',   'Service')),
    ('region',            ('text',   'Region')),
    ('rand1',             ('int',    'Random Index 1')),
    ('rand2',             ('int',    'Random Index 2')),
    ('_id',               ('bigint', 'Ingest Order')),
])


class TaxiViaMongo():

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

    def __init__(self, dbUri=None, **params):
        self.dbUri = dbUri
        db_connection = self.getDbConnection()
        self.database = db_connection.get_default_database()
        self.trips = self.database['trips']
        self.queryBase = 'taxi'

    def processParams(self, params, sort, fields):
        """
        :param params: a dictionary of query restrictions.  See the
                       TaxiFieldTable.  For values that aren't of type 'text',
                       we also support (field)_min and (field)_max parameters,
                       which are inclusive and exclusive respectively.
        :param sort: a list of tuples of the form (key, direction).
        :param fields: a list of fields to return, or None for all fields.
        """
        findParam = {}
        for field in TaxiFieldTable:
            if field in params:
                value = self.getParamValue(field, params[field])
                findParam[field] = value
            if field + '_min' in params:
                value = self.getParamValue(field, params[field + '_min'])
                findParam.setdefault(field, {})
                if isinstance(findParam[field], dict):
                    findParam[field]['$gte'] = value
            if field + '_max' in params:
                value = self.getParamValue(field, params[field + '_max'])
                findParam.setdefault(field, {})
                if isinstance(findParam[field], dict):
                    findParam[field]['$lt'] = value
        query = {}
        for key in findParam:
            query[self.KeyTable.get(key, key)] = findParam[key]
        if sort:
            sort = [(self.KeyTable.get(key, key), dir) for (key, dir) in sort]
        if fields:
            mfields = {self.KeyTable.get(key, key): 1 for key in fields}
            mfields['_id'] = 0
        return query, sort, mfields

    def find(self, params={}, limit=50, offset=0, sort=None, fields=None,
             **kwargs):
        """
        Get data from the mongo database.  Return each row in turn as a python
        object with the default keys or the entire dataset as a list with
        metadata.

        :param params: a dictionary of query restrictions.  See the
                       TaxiFieldTable.  For values that aren't of type 'text',
                       we also support (field)_min and (field)_max parameters,
                       which are inclusive and exclusive respectively.
        :param limit: default limit for the data.
        :param offset: default offset for the data.
        :param sort: a list of tuples of the form (key, direction).
        :param fields: a list of fields to return, or None for all fields.
        :returns: a dictionary of results.
        """
        query, sort, fields = self.processParams(params, sort, fields)
        logger.info('Query %r', ((query, offset, limit, sort, fields), ))
        cursor = self.trips.find(spec=query, skip=offset, limit=limit,
                                 sort=sort, timeout=False, fields=fields)
        total = cursor.count()
        epoch = datetime.datetime.utcfromtimestamp(0)
        dt = datetime.datetime
        result = {'count': total, 'data': [{
            self.RevTable.get(k, k):
            v if not isinstance(v, dt) else int(
                (v - epoch).total_seconds() * 1000)
            for k, v in row.items() if k != '_id'}
            for row in cursor
        ]}
        return result

    def getDbConnection(self):
        """
        Connect to local mongo database named 'taxi' or to the specified
        database URI.

        :return client: a pymongo client.
        """
        clientOptions = {
            'connectTimeoutMS': 15000,
            # 'socketTimeoutMS': 60000,
        }
        dbUri = 'mongodb://parakon:27017/taxi'
        if self.dbUri:
            dbUri = self.dbUri
        # TODO: We should use the reconnect proxy
        return pymongo.MongoClient(dbUri, **clientOptions)

    def getParamValue(self, field, value):
        if value == '':
            return None
        dataType = TaxiFieldTable[field][0]
        if dataType == 'int':
            return int(value)
        if dataType == 'float':
            return float(value)
        if dataType == 'date':
            return dateutil.parser.parse(value)
        return value


class TaxiViaMongoCompact(TaxiViaMongo):

    KeyTable = {
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
    }
    RevTable = {v: k for k, v in KeyTable.items()}

    epoch = datetime.datetime.utcfromtimestamp(0)

    def find(self, params={}, limit=50, offset=0, sort=None, fields=None,
             allowUnsorted=True, **kwargs):
        """
        Get data from the mongo database.  Return each row in turn as a python
        object with the default keys or the entire dataset as a list with
        metadata.

        :param params: a dictionary of query restrictions.  See the
                       TaxiFieldTable.  For values that aren't of type 'text',
                       we also support (field)_min and (field)_max parameters,
                       which are inclusive and exclusive respectively.
        :param limit: default limit for the data.
        :param offset: default offset for the data.
        :param sort: a list of tuples of the form (key, direction).
        :param fields: a list of fields to return, or None for all fields.
        :param allowUnsorted: if true, and the entire data set will be returned
                              (rather than being restricted by limit), then
                              return the data unsorted.
        :returns: a dictionary of results.
        """
        query, sort, mfields = self.processParams(params, sort, fields)
        logger.info('Query %r', ((query, offset, limit, sort, mfields), ))
        cursor = None
        if not offset and sort is not None and allowUnsorted:
            cursor = self.trips.find(spec=query, skip=offset, limit=limit,
                                     sort=None, timeout=False, fields=mfields,
                                     manipulate=False, slave_okay=True,
                                     compile_re=False)
            total = cursor.count()
            if limit and total >= limit:
                cursor = None
        if not cursor:
            cursor = self.trips.find(spec=query, skip=offset, limit=limit,
                                     sort=sort, timeout=False, fields=mfields,
                                     manipulate=False, slave_okay=True,
                                     compile_re=False)
            total = cursor.count()
        if fields:
            columns = {fields[col]: col for col in xrange(len(fields))}
            mcol = [self.KeyTable.get(fields[col], fields[col])
                    for col in xrange(len(fields))]
            result = {
                'count': total,
                'format': 'list',
                'fields': fields,
                'columns': columns,
                'data': [[row[k] for k in mcol] for row in cursor]
            }
        else:
            result = {'count': total, 'data': [{
                self.RevTable.get(k, k): v for k, v in row.items()
                if k != '_id'}
                for row in cursor
            ]}
        return result

    def getParamValue(self, field, value):
        if value == '':
            return None
        dataType = TaxiFieldTable[field][0]
        if dataType == 'int':
            return int(value)
        if dataType == 'float':
            return float(value)
        if dataType == 'date':
            return int((dateutil.parser.parse(value) - self.epoch)
                       .total_seconds() * 1000)
        return value


class TaxiViaMongoRandomized(TaxiViaMongoCompact):
    def find(self, params={}, limit=50, offset=0, sort=None, fields=None,
             **kwargs):
        if not sort:
            sort = [('_id', 1)]
        sort = [('_id', 1)]
        return TaxiViaMongoCompact.find(
            self, params, limit, offset, sort, fields, **kwargs)


class TaxiViaTangeloService():

    KeyTable = {
        'medallion': 'medallion_deanon',
        'hack_license': 'hack_license_deanon',
    }
    RevTable = {v: k for k, v in KeyTable.items()}

    def __init__(self, **params):
        self.url = 'http://damar.kitwarein.com:50000/taxi'
        self.queryBase = 'taxi'

    def find(self, params={}, limit=50, offset=0, sort=None, fields=None,
             **kwargs):
        """
        Get data from the tangelo service.

        :param params: a dictionary of query restrictions.  See the
                       TaxiFieldTable.  For values that aren't of type 'text',
                       we also support (field)_min and (field)_max parameters,
                       which are inclusive and exclusive respectively.
        :param limit: default limit for the data.
        :param offset: default offset for the data.
        :param sort: a tuple of the form (key, direction).  Not currently
                     supported.
        :param fields: a list of fields to return, or None for all fields.
        :returns: a dictionary of results.
        """
        data = {'headers': 'true', 'offset': offset, 'limit': limit}
        for field in TaxiFieldTable:
            if field in params:
                value = params[field]
                if TaxiFieldTable[field][0] == 'date':
                    value = value.replace(' ', '_')
                data[self.KeyTable.get(field, field)] = value
            if field + '_min' in params or field + '_max' in params:
                minvalue = params.get(field + '_min', '')
                maxvalue = params.get(field + '_max', '')
                if TaxiFieldTable[field][0] == 'date':
                    minvalue = minvalue.replace(' ', '_')
                    maxvalue = maxvalue.replace(' ', '_')
                data[self.KeyTable.get(field, field)] = '%s,%s' % (
                    minvalue, maxvalue)
        # Handle sort
        # sort = [(self.KeyTable.get(key, key), dir) for (key, dir) in sort]
        if fields:
            fields = [self.KeyTable.get(key, key) for key in fields]
            data['fields'] = ','.join(fields)
        url = self.url+'?'+urllib.urlencode(data)
        logger.info('Query %r', ((url, data, sort), ))
        results = json.loads(urllib.urlopen(url).read())
        fields = [self.RevTable.get(k, k) for k in results[0]]
        columns = {fields[col]: col for col in xrange(len(fields))}
        return {'format': 'list', 'data': results[1:], 'fields': fields,
                'columns': columns}


class TaxiViaPostgres(ViaPostgres):

    def __init__(self, db=None, **params):
        ViaPostgres.__init__(self, db, **params)
        self.useMilliseconds = True
        self.fieldTable = TaxiFieldTable
        self.tableName = 'trips'
        self.queryBase = 'taxi'


class TaxiViaPostgresSeconds(TaxiViaPostgres):
    # These databases have times in epoch seconds, not epoch milliseconds

    def __init__(self, db=None, **params):
        TaxiViaPostgres.__init__(self, db, **params)
        self.useMilliseconds = False


class TaxiViaPostgresRandom(ViaPostgres):
    # These databases have times in epoch seconds, not epoch milliseconds,
    # and have additional fields for rand1, rand2, etc.

    def __init__(self, db=None, **params):
        ViaPostgres.__init__(self, db, **params)
        self.useMilliseconds = False
        self.fieldTable = TaxiFieldTableRand
        self.tableName = 'trips'
        self.queryBase = 'taxirandom'
        self.defaultSort = [('rand1', 1), ('rand2', 1)]


# -------- Instagram classes and code --------

InstagramFieldTable = collections.OrderedDict([
    ('user_name',     ('text',   'User name')),
    ('user_id_num',   ('int',    'User ID')),  # Some versions use text user_id
    ('posted_date',   ('date',   'Posted date')),
    ('url',           ('text',   'Message URL')),
    ('image_url',     ('text',   'Image URL')),
    ('caption',       ('search', 'Caption')),
    ('latitude',      ('float',  'Latitude')),
    ('longitude',     ('float',  'Longitude')),
    ('location_id',   ('text',   'Location ID')),
    ('location_name', ('text',   'Location')),
    ('comment_count', ('int',    'Comment count')),
    ('comments',      ('text',   'Comments')),
    ('like_count',    ('int',    'Like count')),
    ('likes',         ('text',   'Likes')),
    ('scraped_date',  ('date',   'Scraped date')),
])


class InstagramViaPostgres(ViaPostgres):

    def __init__(self, db=None, **params):
        ViaPostgres.__init__(self, db, **params)
        self.fieldTable = InstagramFieldTable
        self.tableName = 'instagram'
        self.alwaysUseIdSort = False
        self.queryBase = 'instagram'


# -------- Message classes and code --------

MessageFieldTable = collections.OrderedDict([
    ('msg_id',            ('text',   'Message ID')),
    ('user_id',           ('text',   'User ID')),
    ('user_name',         ('text',   'User name')),
    ('msg_date',          ('date',   'Message date')),
    ('msg_date_ms',       ('float',  'Message date')),
    ('url',               ('text',   'Message URL')),
    ('image_url',         ('text',   'Image URL')),
    ('msg',               ('search', 'Message')),
    ('latitude',          ('float',  'Latitude')),
    ('longitude',         ('float',  'Longitude')),
    ('location_id',       ('text',   'Location ID')),
    ('location_name',     ('text',   'Location')),
    ('reply_to_msg_id',   ('text',   'In Reply To Message ID')),
    ('reply_to_user_id',  ('text',   'In Reply To User ID')),
    ('utc_offset',        ('int',    'User UTC Offset')),
    ('last_msg_id',       ('text',   'Last Message ID')),
    ('last_msg_date',     ('date',   'Last Message date')),
    ('last_latitude',     ('float',  'Last Latitude')),
    ('last_longitude',    ('float',  'Last Longitude')),
    ('ingest_date',       ('date',   'Ingest Date')),
    ('ingest_source',     ('text',   'Ingest Source')),
    ('service',           ('text',   'Service')),
    ('region',            ('text',   'Region')),
    ('rand1',             ('int',    'Random Index 1')),
    ('rand2',             ('int',    'Random Index 2')),
    ('_id',               ('bigint', 'Ingest Order')),
])

MsgToInstKeyTable = {
    'msg_id': None,
    'user_id': None,
    'msg_date': 'posted_date',
    'msg_date_ms': None,
    'msg': 'caption',
    'reply_to_msg_id': None,
    'reply_to_user_id': None,
    'utc_offset': None,
    'rand1': None,
    'rand2': None,
    'last_msg_id': None,
    'last_msg_date': None,
    'last_latitude': None,
    'last_longitude': None,
    'ingest_date': 'scraped_date',
}
InstToMsgKeyTable = {v: k for k, v in MsgToInstKeyTable.items()}


class MessageViaPostgres(ViaPostgres):
    def __init__(self, db=None, **params):
        ViaPostgres.__init__(self, db, **params)
        self.fieldTable = MessageFieldTable
        self.useMilliseconds = False
        self.tableName = 'messages'
        self.alwaysUseIdSort = False
        self.defaultSort = [('rand1', 1), ('rand2', 1)]
        self.decoder = HTMLParser.HTMLParser()
        self.queryBase = 'message'


class RealTimeViaPostgres(ViaPostgres):
    def __init__(self, db=None, **params):
        ViaPostgres.__init__(self, db, **params)
        self.fieldTable = MessageFieldTable
        self.useMilliseconds = False
        self.tableName = 'messages'
        self.alwaysUseIdSort = False
        self.defaultSort = [('rand1', 1), ('rand2', 1)]
        self.decoder = HTMLParser.HTMLParser()
        self.queryBase = 'message'
        self.realtime = True

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


# -------- General classes and code --------

def findGeneralDescription(desc, sortKey, fieldTable, defaultDbKey):
    """
    Generate a description for a find endpoint that automatically adds all the
    fields from a field table.

    :param desc: the primary description of this endpoint.
    :param sortKey: the default sortKey for the query.
    :param fieldTable: an ordered dictionary with the fields that can be used.
    :param defaultDbKey: the default database source.
    :returns: the generated Description object.
    """
    description = (
        Description(desc)
        .param('source', 'Database source (default %s).' % defaultDbKey,
               required=False)
        .param('limit', 'Result set size limit (default=50).',
               required=False, dataType='int')
        .param('offset', 'Offset into result set (default=0).',
               required=False, dataType='int')
        .param('sort', 'Field to sort the user list by (default=%s)' % (
               sortKey, ), required=False)
        .param('sortdir', '1 for ascending, -1 for descending (default=1)',
               required=False, dataType='int')
        .param('fields', 'A comma-separated list of fields to return '
               '(default is all fields).', required=False)
        .param('format', 'The format to return the data (default is '
               'list).', required=False, enum=['list', 'dict'])
        .param('clientid', 'A string to use for a client id.  If specified '
               'there is an extant query to this end point from the same '
               'clientid, the extant query will be cancelled.', required=False)
        .param('wait', 'Maximum duration in seconds to wait for data '
               '(default=0).', required=False, dataType='float',
               default=0)
        .param('poll', 'Minimum interval in seconds between checking for data '
               'when waiting (default=10).', required=False, dataType='float',
               default=10)
        .param('initwait', 'When waiting, initial delay in seconds before '
               'starting to poll for more data.  This is not counted as part '
               'of the wait duration (default=0).', required=False,
               dataType='float', default=0))
    for field in sorted(fieldTable):
        (fieldType, fieldDesc) = fieldTable[field]
        dataType = fieldType
        if fieldType == 'text' or fieldType == 'search':
            dataType = 'string'
        description.param(field, fieldDesc, required=False, dataType=dataType)
        if fieldType != 'text' and fieldType != 'search':
            description.param(
                field + '_min', 'Minimum value (inclusive) of ' + fieldDesc,
                required=False, dataType=dataType)
            description.param(
                field + '_max', 'Maximum value (exclusive) of ' + fieldDesc,
                required=False, dataType=dataType)
        if fieldType == 'search':
            description.param(
                field + '_search', 'tsquery search of ' + fieldDesc,
                required=False, dataType='string')
    return description


class GeoAppResource(girder.api.rest.Resource):
    """API endpoint for geoapp data including taxi data."""

    def __init__(self):
        self.resourceName = 'geoapp'
        self.route('POST', ('ingest', ), self.ingestMessages)
        self.route('GET', ('instagram', ), self.findInstagram)
        self.route('GET', ('message', ), self.findMessage)
        self.route('PUT', ('reporttest', ), self.storeTestResults)
        self.route('PUT', ('reporttest', ':id'), self.updateTestResults)
        self.route('GET', ('taxi', ), self.findTaxi)
        self.route('GET', ('tiles', 'blank', ':wc1', ':wc2', ':wc3'),
                   self.blankTiles)
        self.route('GET', ('tiles', 'grid', ':wc1', ':wc2', ':wc3'),
                   self.gridTiles)
        config = girder.utility.config.getConfig()
        for attrKey, confKey in [
            ('taxiAccess', 'taxidata'),
            ('instagramAccess', 'instagramdata')
        ]:
            accessDict = {}
            for key in config.get(confKey, {}):
                db = config[confKey][key]
                if not isinstance(db, dict) or 'class' not in db:
                    continue
                if db['class'] in globals():
                    accessDict[key] = (globals()[db['class']],
                                       db.get('params', {}))
            setattr(self, attrKey, accessDict)

    def findGeneral(self, params, sortKey, fieldTable, accessList,
                    defaultDbKey, **kwargs):
        """
        Perform a database search for a general find endpoint.

        :param params: the parameters of the endpoint call.
        :param sortKey: the default sortKey for the query.
        :param fieldTable: an ordered dictionary with the fields that can be
                           used.
        :param accessList: a dictionary of access classes used to query
                           different databases.
        :param defaultDbKey: the default database source.  Used with the
                             accessList.
        :returns: the database response.
        """
        limit, offset, sort = self.getPagingParameters(params, sortKey)
        if sort is None and sortKey:
            sort = sortKey
        fields = params.get('fields', '').replace(',', ' ').strip().split()
        if not fields or not len(fields):
            fields = fieldTable.keys()
        accessObj = accessList[params.get('source', defaultDbKey)]
        if isinstance(accessObj, tuple):
            accessObj = accessObj[0](**accessObj[1])
            accessList[params.get('source', defaultDbKey)] = accessObj
        wait = params.get('wait', None)
        wait = None if not wait or wait <= 0 else float(wait)
        poll = params.get('poll', None)
        poll = 10 if not poll or poll <= 0 else float(poll)
        initwait = params.get('initwait', None)
        initwait = None if not initwait or initwait <= 0 else float(initwait)
        kwargs['wait'] = wait
        kwargs['poll'] = poll
        kwargs['initwait'] = initwait

        def resultFunc():
            if wait and initwait:
                time.sleep(initwait)
                yield ' '
            starttime = time.time()
            while True:
                result = accessObj.find(
                    params, limit, offset, sort, fields, **kwargs)
                if result is None:
                    cherrypy.response.status = 500
                    raise StopIteration
                result['datacount'] = len(result.get('data', []))
                curtime = time.time()
                if (not wait or result['datacount'] or
                        curtime >= starttime + wait):
                    break
                # Keep alive that should have no ill-effect on the json output
                yield ' '
                time.sleep(max(min(poll, starttime + wait - curtime),
                               poll * 0.5))
                yield ' '
                if '_id_min' in params and 'nextId' in result:
                    params['_id_min'] = result['nextId']
            result['limit'] = limit
            result['offset'] = offset
            result['sort'] = sort
            if (params.get('format', 'list') == 'list' and
                    result.get('format', '') != 'list'):
                result['fields'] = fields
                result['columns'] = {fields[col]: col
                                     for col in xrange(len(fields))}
                if 'data' in result:
                    result['data'] = [
                        [row.get(field, None) for field in fields]
                        for row in result['data']
                    ]
                result['format'] = 'list'
            elif (params.get('format', 'list') != 'list' and
                    result.get('format', '') == 'list'):
                if 'data' in result:
                    result['data'] = [{
                        result['fields'][col]: row[col] for col
                        in xrange(len(row))} for row in result['data']]
                result['format'] = 'dict'
                del result['columns']
            # We could let Girder convert the results into JSON, but it is
            # marginally faster to dump the JSON ourselves, since we can
            # exclude sorting and reduce whitespace
            # return result
            yield json.dumps(
                result, check_circular=False, separators=(',', ':'),
                sort_keys=False, default=str)

        cherrypy.response.headers['Content-Type'] = 'application/json'
        return resultFunc

    def getUserAndFolder(self):
        """
        Get the geoapp user and test results folder.  If the geoapp user,
        collection, or folder do not exist, create them.

        :return: the geoapp user.
        :return: the geoapp test results folder.
        """
        user = self.model('user').findOne({'login': GeoappUser['login']})
        # if we don't have our expected user, try to create it
        if user is None:
            user = self.model('user').createUser(**GeoappUser)
        coll = self.model('collection').findOne({'name': 'geoapp'})
        if coll is None:
            coll = self.model('collection').createCollection('geoapp', user,
                                                             public=True)
        folderName = 'Test Results'
        folder = self.model('folder').findOne({
            'name': folderName,
            'parentId': coll['_id'],
            'parentCollection': 'collection'})
        if not folder:
            folder = self.model('folder').createFolder(
                coll, folderName, parentType='collection', public=True,
                creator=user)
        return user, folder

    def getMetadataFromBody(self, addRequestInfo=True):
        """
        Extract metadata from the request body and validate the keys.

        :param addRequestInfo: if true, add information about this request to
                               the metadata under the key 'requestInfo'.
        :returns: metadata dictionary.
        """
        try:
            metadata = json.load(cherrypy.request.body)
        except ValueError:
            raise RestException('Invalid JSON passed in request body.')
        for k in metadata:
            if not len(k):
                raise RestException('Key names must be at least one character '
                                    'long.')
            if '.' in k or k[0] == '$':
                raise RestException(u'The key name {} must not contain a '
                                    'period or begin with a dollar sign.'
                                    .format(k))
        if addRequestInfo:
            base = cherrypy.request.base
            altbase = cherrypy.request.headers.get('X-Forwarded-Host', '')
            if altbase:
                base = '%s://%s' % (cherrypy.request.scheme, altbase)
            metadata['requestInfo'] = {
                'base': base,
                'remote_ip': cherrypy.request.remote.ip,
            }
        return metadata

    @access.public
    def findInstagram(self, params):
        return self.findGeneral(
            params, '_id', InstagramFieldTable, self.instagramAccess,
            'postgres', queryBase='instagram')
    findInstagram.description = findGeneralDescription(
        'Get a set of instagram data.', '_id', InstagramFieldTable, 'postgres')

    @access.public
    def findMessage(self, params):
        where = []
        if not self.boolParam('nullgeo', params, default=False):
            where.append('latitude is not NULL')
        return self.findGeneral(
            params, [('rand1', 1), ('rand2', 1)], MessageFieldTable,
            self.instagramAccess, 'rtmsg', queryBase='message',
            whereClauses=where)
    findMessage.description = (
        findGeneralDescription(
            'Get a set of message data.', 'rand1', MessageFieldTable, 'rtmsg')
        .param('nullgeo', 'Include messages without latitude and longitude '
               '(default=false).', required=False, dataType='boolean',
               default=False))

    @access.public
    def findTaxi(self, params):
        return self.findGeneral(
            params, 'pickup_datetime', TaxiFieldTableRand, self.taxiAccess,
            'mongo', queryBase='taxi')
    findTaxi.description = findGeneralDescription(
        'Get a set of taxi data.', 'pickup_datetime', TaxiFieldTableRand,
        'mongo')

    @access.public
    def ingestMessages(self, params):
        starttime = time.time()
        res = {'ingested': 0}
        defaultDbKey = 'rtmsg'
        accessList = self.instagramAccess
        accessObj = accessList[params.get('source', defaultDbKey)]
        ingestFrom = params.get('from', None)
        nodup = params.get('nodup', False)
        if isinstance(accessObj, tuple):
            accessObj = accessObj[0](**accessObj[1])
            accessList[params.get('source', defaultDbKey)] = accessObj
        log = None
        if 'log' in params and params['log'].isdigit():
            log = int(params['log'])
        db = accessObj.connect('fresh')
        c = db.cursor()
        for line in cherrypy.request.body:
            try:
                data = json.loads(line.decode('utf8'))
                if accessObj.ingestTwitter(db, c, data, ingestFrom, nodup):
                    res['ingested'] += 1
                    if log and not res['ingested'] % log:
                        duration = time.time() - starttime
                        if duration:
                            logger.info('Rate: %5.3f msg/s over %d msgs' % (
                                res['ingested'] / duration, res['ingested']))
                else:
                    res['skipped'] = res.get('skipped', 0) + 1
            except ValueError:
                res['badjson'] = res.get('badjson', 0) + 1
        if res['ingested'] and cherrypy.response.status == 500:
            cherrypy.response.status = 200
        res['duration'] = time.time() - starttime
        if res['duration']:
            res['rate'] = res['ingested'] / res['duration']
        logger.info('Ingest %r', res)
        return res
    ingestMessages.description = (
        Description('Accept line-by-line json data for a Twitter or Instagram '
                    'feed.')
        .notes('This expects data to be as sent by the Twitter firehose '
               'protocol.  Anything else probably won\'t work.  Duplicates '
               'are culled, user trails are computed, and images are fetched '
               'using background tasks.')
        .param('body', 'The line-by-line json for the feed.', paramType='body')
        .param('source', 'Database source (default rtmsg).', required=False)
        .param('from', 'Ingest source description.', required=False)
        .param('log', 'If set, log every this many messages to show progress.',
               dataType='int', required=False)
        .param('nodup', 'If set, try to avoid duplicate message ids.',
               dataType='bool', default=False, required=False)
        .errorResponse('Invalid JSON passed in request body.'))

    @access.public
    def storeTestResults(self, params):
        user, folder = self.getUserAndFolder()
        name = params.get('name', 'Results')
        item = self.model('item').createItem(name, user, folder)
        metadata = self.getMetadataFromBody()
        return self.model('item').setMetadata(item, metadata)
    storeTestResults.description = (
        Description('Submit new test results.')
        .responseClass('Item')
        .param('body', 'A JSON object containing metadata with the test '
               'results.', paramType='body')
        .param('name', 'Name for the item.', required=False)
        .errorResponse('Invalid JSON passed in request body.')
        .errorResponse('Metadata key name was invalid.'))

    @access.public
    def updateTestResults(self, id, params):
        user, folder = self.getUserAndFolder()
        item = self.model('item').load(id=id, level=AccessType.WRITE,
                                       user=user)
        metadata = self.getMetadataFromBody()
        return self.model('item').setMetadata(item, metadata)
    updateTestResults.description = (
        Description('Update existing test results.')
        .responseClass('Item')
        .param('id', 'The ID of a test result item to update',
               paramType='path', required=False)
        .param('body', 'A JSON object containing metadata with the test '
               'results.', paramType='body')
        .errorResponse('ID was invalid.')
        .errorResponse('Invalid JSON passed in request body.')
        .errorResponse('Metadata key name was invalid.'))

    @access.public
    def blankTiles(self, wc1, wc2, wc3, params):
        def resultFunc():
            yield (
                '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00'
                '\x00\x00\x01\x08\x04\x00\x00\x00\xb5\x1c\x0c\x02\x00\x00'
                '\x00\x0bIDAT\x18Wc``\x00\x00\x00\x03\x00\x01h&Y\r\x00\x00'
                '\x00\x00IEND\xaeB`\x82')

        cherrypy.response.headers['Content-Type'] = 'image/png'
        return resultFunc
    blankTiles.description = (
        Description('Always send a transparent 1x1 pixel PNG.')
        .param('wc1', 'Ignored', paramType='path', required=True)
        .param('wc2', 'Ignored', paramType='path', required=True)
        .param('wc3', 'Ignored', paramType='path', required=True))

    @access.public
    def gridTiles(self, wc1, wc2, wc3, params):
        def resultFunc():
            yield binascii.a2b_base64(
                'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEABAMAAACuXLVVAAAAD1BMVEUAAABAQ'
                'ECAgIDAwMD///8E6R8uAAAA0ElEQVR42u3cuQ2AQAwEQPM0wFMB0AGUQP81EU'
                'PABQ6czGYny9JIm1oXUZ3xfuf6vI/GfE3uAwAAAAAAAAAAAAAAAAAAxHD+Z2/'
                'Ml+S+CgAAAAAAAAAAAAAAAAAA6gH9lsuc3FcBAAAAAAAAAAAAAAAAAID7ARUA'
                'AAAAAAAAAAAAAAAAANQDuqk2KgAAAAAAAAAAAAAAAAAAcD+gAgAAAAAAAAAAA'
                'AAAAAAA/w+oAAAAAAAAAAAAAAAAAADA/YAKAAAAAAAAAAAAAAAAAADKAQ8My5'
                'exgH1vAAAAAABJRU5ErkJggg==')

        cherrypy.response.headers['Content-Type'] = 'image/png'
        return resultFunc
    gridTiles.description = (
        Description('Send a precise 256x256 grid tile PNG.')
        .param('wc1', 'Ignored', paramType='path', required=True)
        .param('wc2', 'Ignored', paramType='path', required=True)
        .param('wc3', 'Ignored', paramType='path', required=True))


def load(info):
    """
    Attach our API to the appropriate spot.

    :param info: a dictionary of server settings, of which the apiRoot value
                 is used.
    """
    info['apiRoot'].geoapp = GeoAppResource()
