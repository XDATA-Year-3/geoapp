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

# This file exposes an endpoint to get taxi data and has a class to handle
# getting the data from a mongo instance

import cherrypy
import collections
import datetime
import dateutil.parser
import json
import pymongo
import time
import urllib

import girder.api.rest
from girder import logger
from girder.api import access
from girder.constants import AccessType
from girder.api.describe import Description
from girder.api.rest import RestException

pgdb = None


GeoappUser = {
    'login': 'geoapp',
    'password': 'geoapp#1',
    'firstName': 'geoapp',
    'lastName': 'geoapp',
    'email': 'noemail@noemail.com',
    'admin': False
}

FieldTable = collections.OrderedDict([
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

    ('random', ('float', 'Random value [0-1)')),
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

        'random': 'rnd',
    }
    RevTable = {v: k for k, v in KeyTable.items()}

    def __init__(self, dbUri=None, **params):
        self.dbUri = dbUri
        db_connection = self.getDbConnection()
        self.database = db_connection.get_default_database()
        self.trips = self.database['trips']

    def processParams(self, params, sort, fields):
        """
        :param params: a dictionary of query restrictions.  See the
                       FieldTable.  For values that aren't of type 'text',
                       we also support (field)_min and (field)_max parameters,
                       which are inclusive and exclusive respectively.
        :param sort: a list of tuples of the form (key, direction).
        :param fields: a list of fields to return, or None for all fields.
        """
        findParam = {}
        for field in FieldTable:
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

    def find(self, params={}, limit=50, offset=0, sort=None, fields=None):
        """
        Get data from the mongo database.  Return each row in turn as a python
        object with the default keys or the entire dataset as a list with
        metadata.

        :param params: a dictionary of query restrictions.  See the
                       FieldTable.  For values that aren't of type 'text',
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
        dataType = FieldTable[field][0]
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

        'random': 'r',
    }
    RevTable = {v: k for k, v in KeyTable.items()}

    epoch = datetime.datetime.utcfromtimestamp(0)

    def find(self, params={}, limit=50, offset=0, sort=None, fields=None,
             allowUnsorted=True):
        """
        Get data from the mongo database.  Return each row in turn as a python
        object with the default keys or the entire dataset as a list with
        metadata.

        :param params: a dictionary of query restrictions.  See the
                       FieldTable.  For values that aren't of type 'text',
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
        dataType = FieldTable[field][0]
        if dataType == 'int':
            return int(value)
        if dataType == 'float':
            return float(value)
        if dataType == 'date':
            return int((dateutil.parser.parse(value) - self.epoch)
                       .total_seconds() * 1000)
        return value


class TaxiViaMongoRandomized(TaxiViaMongoCompact):
    def find(self, params={}, limit=50, offset=0, sort=None, fields=None):
        if not sort:
            sort = [('_id', 1)]
        elif sort[0][0] == 'random':
            sort[0] = ('_id', 1)
        sort = [('_id', 1)]
        return TaxiViaMongoCompact.find(self, params, limit, offset, sort,
                                        fields)


class TaxiViaTangeloService():

    KeyTable = {
        'medallion': 'medallion_deanon',
        'hack_license': 'hack_license_deanon',
    }
    RevTable = {v: k for k, v in KeyTable.items()}

    def __init__(self, **params):
        self.url = 'http://damar.kitwarein.com:50000/taxi'

    def find(self, params={}, limit=50, offset=0, sort=None, fields=None):
        """
        Get data from the tangelo service.

        :param params: a dictionary of query restrictions.  See the
                       FieldTable.  For values that aren't of type 'text',
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
        for field in FieldTable:
            if field in params:
                value = params[field]
                if FieldTable[field][0] == 'date':
                    value = value.replace(' ', '_')
                data[self.KeyTable.get(field, field)] = value
            if field + '_min' in params or field + '_max' in params:
                minvalue = params.get(field + '_min', '')
                maxvalue = params.get(field + '_max', '')
                if FieldTable[field][0] == 'date':
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


class TaxiViaPostgres():

    epoch = datetime.datetime.utcfromtimestamp(0)

    def __init__(self, db=None, **params):
        self.dbname = db
        self.dbparams = params.copy()
        if db is not None:
            self.dbparams['database'] = db
        if not self.dbparams['database'] and not self.dbparams['dsn']:
            self.dbparams['dsn'] = 'parakon:taxi12r:taxi:taxi#1'
        self.connect()

    def connect(self):
        """
        Connect to the database.
        """
        global pgdb
        if not pgdb:
            # We can use either psycopg2 or pgdb.  Provided one only uses %s
            # formatting, the interface is equiavlent.  psycopg2 starts much
            # slower than pgdb (seemingly, the first connection takes 5 seconds
            # for some reason).  psycopg2 converts data to native python
            # formats substantially faster, though.  If we were to use a custom
            # results-to-json format, then I don't know which would be faster.
            # Import either library as pgdb, and that library will be used.
            # import pgdb
            import psycopg2 as pgdb
        if getattr(self, 'db', None):
            try:
                self.db.close()
            except Exception:
                pass
        self.db = pgdb.connect(**self.dbparams)

    def find(self, params={}, limit=50, offset=0, sort=None, fields=None):
        """
        Get data from a postgres database.

        :param params: a dictionary of query restrictions.  See the
                       FieldTable.  For values that aren't of type 'text',
                       we also support (field)_min and (field)_max parameters,
                       which are inclusive and exclusive respectively.
        :param limit: default limit for the data.
        :param offset: default offset for the data.
        :param sort: a tuple of the form (key, direction).  Not currently
                     supported.
        :param fields: a list of fields to return, or None for all fields.
        :returns: a dictionary of results.
        """
        starttime = time.time()
        # shuffled order
        sort = [('_id', 1)]
        sql = ['SELECT']
        if not fields:
            fields = [field[0] for field in FieldTable[:-1]]
        if hasattr(self, 'adjustReturnFields'):
            sql.append(','.join(self.adjustReturnFields(fields)))
        else:
            sql.append(','.join(fields))
        sql.append('FROM trips WHERE true')
        sqlval = []
        self.params_to_sql(params, sql, sqlval)

        if sort:
            sql.append('ORDER BY')
            sorts = []
            for sortval in sort:
                sortstr = '%s' % sortval[0]
                if sortval[1] == -1:
                    sortstr += ' DESC'
                else:
                    sortstr += ' ASC'
                sorts.append(sortstr)
            sql.append(','.join(sorts))
        if limit:
            sql.append('LIMIT %d' % limit)
        if offset:
            sql.append('OFFSET %d' % offset)
        sql = ' '.join(sql)
        logger.info('Query: %s' % (sql % tuple(sqlval)))
        columns = {fields[col]: col for col in xrange(len(fields))}
        # TODO: If this fails, try to reconnect to the database
        try:
            c = self.db.cursor()
            c.execute(sql, sqlval)
        except pgdb.Error as exc:
            logger.info('Database error %s', str(exc))
            self.connect()
            c = self.db.cursor()
            c.execute(sql, sqlval)
        logger.info('Query execution took %5.3fs', time.time() - starttime)
        result = {
            'format': 'list',
            'fields': fields,
            'columns': columns,
            'data': c.fetchmany()
            }
        logger.info('Fetching first items (%5.3fs including query execution)',
                    time.time() - starttime)
        while True:
            data = c.fetchmany()
            if data:
                result['data'].extend(data)
            else:
                break
        logger.info('Fetching data (%5.3fs including query execution)',
                    time.time() - starttime)
        c.close()
        return result

    def params_to_sql(self, params, sql, sqlval):
        """
        Convert params to sql.

        :param params: a dictionary of query restrictions.
        :param sql: a list of sql statement fragments.  Modified.
        :param sqlval: a list of sql values to escape.  Modified.
        """
        for field in FieldTable:
            for comp, suffix in [('=', ''), ('>=', '_min'), ('<', '_max')]:
                if field + suffix not in params:
                    continue
                value = params[field + suffix]
                dtype = FieldTable[field][0]
                if dtype == 'date':
                    value = int((dateutil.parser.parse(value) - self.epoch)
                                .total_seconds() * 1000)
                    sql.append('AND ' + field + comp + '%d' % value)
                elif dtype == 'int':
                    value = int(value)
                    sql.append('AND ' + field + comp + '%d' % value)
                elif dtype == 'float':
                    value = float(value)
                    sql.append('AND ' + field + comp + '%f' % value)
                else:
                    value = str(value)
                    sql.append('AND ' + field + comp + '%s')
                    sqlval.append(value)


class TaxiViaPostgresSeconds(TaxiViaPostgres):
    # These databases have times in epoch seconds, not epoch milliseconds
    def adjustReturnFields(self, fields):
        newfields = []
        for field in fields:
            if FieldTable[field][0] == 'date':
                newfields.append(field + ' * 1000::bigint')
            else:
                newfields.append(field)
        return newfields

    def params_to_sql(self, params, sql, sqlval):
        """
        Convert params to sql.

        :param params: a dictionary of query restrictions.
        :param sql: a list of sql statement fragments.  Modified.
        :param sqlval: a list of sql values to escape.  Modified.
        """
        for field in FieldTable:
            for comp, suffix in [('=', ''), ('>=', '_min'), ('<', '_max')]:
                if field + suffix not in params:
                    continue
                value = params[field + suffix]
                dtype = FieldTable[field][0]
                if dtype == 'date':
                    value = int((dateutil.parser.parse(value) - self.epoch)
                                .total_seconds())
                    sql.append('AND ' + field + comp + '%d' % value)
                elif dtype == 'int':
                    value = int(value)
                    sql.append('AND ' + field + comp + '%d' % value)
                elif dtype == 'float':
                    value = float(value)
                    sql.append('AND ' + field + comp + '%f' % value)
                else:
                    value = str(value)
                    sql.append('AND ' + field + comp + '%s')
                    sqlval.append(value)


class Taxi(girder.api.rest.Resource):
    """API endpoint for taxi data."""

    def __init__(self):
        self.resourceName = 'taxi'
        self.route('GET', (), self.find)
        self.route('GET', ('tiles', 'blank', ':wc1', ':wc2', ':wc3'),
                   self.blankTiles)
        self.route('PUT', ('reporttest', ), self.storeTestResults)
        self.route('PUT', ('reporttest', ':id'), self.updateTestResults)
        config = girder.utility.config.getConfig()
        self.access = {}
        for key in config.get('taxidata', {}):
            db = config['taxidata'][key]
            if not isinstance(db, dict) or 'class' not in db:
                continue
            if db['class'] in globals():
                self.access[key] = (globals()[db['class']],
                                    db.get('params', {}))

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
    def find(self, params):
        limit, offset, sort = self.getPagingParameters(params,
                                                       'pickup_datetime')
        fields = None
        if 'fields' in params:
            fields = params['fields'].replace(',', ' ').strip().split()
            if not len(fields):
                fields = None
        access = self.access[params.get('source', 'mongo')]
        if isinstance(access, tuple):
            access = access[0](**access[1])
            self.access[params.get('source', 'mongo')] = access
        result = access.find(params, limit, offset, sort, fields)
        result['limit'] = limit
        result['offset'] = offset
        result['sort'] = sort
        result['datacount'] = len(result.get('data', []))
        if params.get('format', None) == 'list':
            if result.get('format', '') != 'list':
                if not fields:
                    fields = FieldTable.keys()
                result['fields'] = fields
                result['columns'] = {fields[col]: col
                                     for col in xrange(len(fields))}
                if 'data' in result:
                    result['data'] = [
                        [row.get(field, None) for field in fields]
                        for row in result['data']
                    ]
                result['format'] = 'list'
        else:
            if result.get('format', '') == 'list':
                if 'data' in result:
                    result['data'] = [{
                        result['fields'][col]: row[col]
                        for col in xrange(len(row))} for row in result['data']]
                result['format'] = 'dict'
                del result['columns']
        # We could let Girder convert the results into JSON, but it is
        # marginally faster to dump the JSON ourselves, since we can exclude
        # sorting and reduce whitespace
        # return result

        def resultFunc():
            yield json.dumps(
                result, check_circular=False, separators=(',', ':'),
                sort_keys=False, default=str)

        cherrypy.response.headers['Content-Type'] = 'application/json'
        return resultFunc

    find.description = (
        Description('Get a set of taxi data.')
        .param('source', 'Database source (default mongo).', required=False)
        .param('limit', 'Result set size limit (default=50).', required=False,
               dataType='int')
        .param('offset', 'Offset into result set (default=0).', required=False,
               dataType='int')
        .param('sort', 'Field to sort the user list by (default='
               'pickup_datetime)', required=False)
        .param('sortdir', '1 for ascending, -1 for descending (default=1)',
               required=False, dataType='int')
        .param('fields', 'A comma-separated list of fields to return (default '
               'is all fields).', required=False)
        .param('format', 'The format to return the data (default is dict).',
               required=False, enum=['dict', 'list']))
    for field in sorted(FieldTable):
        (fieldType, fieldDesc) = FieldTable[field]
        dataType = fieldType
        if dataType == 'text':
            dataType = 'string'
        find.description.param(field, fieldDesc, required=False,
                               dataType=dataType)
        if fieldType != 'text':
            find.description.param(
                field+'_min', 'Minimum value (inclusive) of ' + fieldDesc,
                required=False, dataType=dataType)
            find.description.param(
                field+'_max', 'Maximum value (exclusive) of ' + fieldDesc,
                required=False, dataType=dataType)

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


def load(info):
    """
    Attach our API to the appropriate spot.

    :param info: a dictionary of server settings, of which the apiRoot value
                 is used.
    """
    info['apiRoot'].taxi = Taxi()
