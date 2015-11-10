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

import base64
import cherrypy
import collections
import datetime
import dateutil.parser
import HTMLParser
import json
import pymongo
import time
import urllib
import urllib2

import girder.api.rest
from girder import logger
from girder.api import access
from girder.constants import AccessType
from girder.api.describe import Description
from girder.api.rest import RestException

import dataelasticsearch
import datapostgres


GeoappUser = {
    'login': 'geoapp',
    'password': 'geoapp#1',
    'firstName': 'geoapp',
    'lastName': 'geoapp',
    'email': 'noemail@noemail.com',
    'admin': False
}


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


class TaxiViaPostgres(datapostgres.ViaPostgres):

    def __init__(self, db=None, **params):
        datapostgres.ViaPostgres.__init__(self, db, **params)
        self.useMilliseconds = True
        self.fieldTable = TaxiFieldTable
        self.tableName = 'trips'
        self.queryBase = 'taxi'


class TaxiViaPostgresSeconds(TaxiViaPostgres):
    # These databases have times in epoch seconds, not epoch milliseconds

    def __init__(self, db=None, **params):
        TaxiViaPostgres.__init__(self, db, **params)
        self.useMilliseconds = False


class TaxiViaPostgresRandom(datapostgres.ViaPostgres):
    # These databases have times in epoch seconds, not epoch milliseconds,
    # and have additional fields for rand1, rand2, etc.

    def __init__(self, db=None, **params):
        datapostgres.ViaPostgres.__init__(self, db, **params)
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


class InstagramViaPostgres(datapostgres.ViaPostgres):

    def __init__(self, db=None, **params):
        datapostgres.ViaPostgres.__init__(self, db, **params)
        self.fieldTable = InstagramFieldTable
        self.tableName = 'instagram'
        self.alwaysUseIdSort = False
        self.queryBase = 'instagram'


# -------- Message classes and code --------

MessageFieldTable = collections.OrderedDict([
    ('msg_id',            ('commalist', 'Message ID')),
    ('user_id',           ('commalist', 'User ID')),
    ('user_name',         ('commalist', 'User name')),
    ('msg_date',          ('date',      'Message date')),
    ('msg_date_ms',       ('float',     'Message date')),
    ('url',               ('text',      'Message URL')),
    ('image_url',         ('text',      'Image URL')),
    ('msg',               ('search',    'Message')),
    ('latitude',          ('float',     'Latitude')),
    ('longitude',         ('float',     'Longitude')),
    ('location_id',       ('commalist', 'Location ID')),
    ('location_name',     ('text',      'Location')),
    ('reply_to_msg_id',   ('commalist', 'In Reply To Message ID')),
    ('reply_to_user_id',  ('commalist', 'In Reply To User ID')),
    ('utc_offset',        ('int',       'User UTC Offset')),
    ('last_msg_id',       ('commalist', 'Last Message ID')),
    ('last_msg_date',     ('date',      'Last Message date')),
    ('last_latitude',     ('float',     'Last Latitude')),
    ('last_longitude',    ('float',     'Last Longitude')),
    ('ingest_date',       ('date',      'Ingest Date')),
    ('ingest_source',     ('commalist', 'Ingest Source')),
    ('service',           ('commalist', 'Service')),
    ('region',            ('commalist', 'Region')),
    ('rand1',             ('int',       'Random Index 1')),
    ('rand2',             ('int',       'Random Index 2')),
    ('_id',               ('bigint',    'Ingest Order')),
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


class MessageViaPostgres(datapostgres.ViaPostgres):
    def __init__(self, db=None, **params):
        datapostgres.ViaPostgres.__init__(self, db, **params)
        self.fieldTable = MessageFieldTable
        self.useMilliseconds = False
        self.tableName = 'messages'
        self.alwaysUseIdSort = False
        self.defaultSort = [('rand1', 1), ('rand2', 1)]
        self.decoder = HTMLParser.HTMLParser()
        self.queryBase = 'message'


class RealTimeViaPostgres(MessageViaPostgres):
    def __init__(self, db=None, **params):
        MessageViaPostgres.__init__(self, db, **params)
        self.realtime = True


class MessageViaElasticsearch(dataelasticsearch.ViaElasticsearch):
    def __init__(self, db=None, **params):
        dataelasticsearch.ViaElasticsearch.__init__(self, db, **params)
        self.fieldTable = MessageFieldTable
        self.realtime = False


class MessageRealTimeViaElasticsearch(MessageViaElasticsearch):
    def __init__(self, db=None, **params):
        MessageViaElasticsearch.__init__(self, db, **params)
        self.realtime = True


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
        self.route('GET', ('intents', ), self.getIntents)
        self.route('GET', ('message', ), self.findMessage)
        self.route('PUT', ('reporttest', ), self.storeTestResults)
        self.route('PUT', ('reporttest', ':id'), self.updateTestResults)
        self.route('GET', ('taxi', ), self.findTaxi)
        self.route('GET', ('tiles', 'blank', ':wc1', ':wc2', ':wc3'),
                   self.blankTiles)
        self.route('GET', ('tiles', ':tilename', ':wc1', ':wc2', ':wc3'),
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
                    # This error code may not get to the client because we are
                    # using a generator function
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
    def gridTiles(self, tilename, wc1, wc2, wc3, params):
        raise cherrypy.HTTPRedirect('/built/tile%s.png' % tilename)
    gridTiles.description = (
        Description('Send a precise 256x256 grid tile PNG.')
        .param('tilename', 'Root of tile image name.  This serves '
               'built/tile(tilename).png.', paramType='path', required=True)
        .param('wc1', 'Ignored', paramType='path', required=True)
        .param('wc2', 'Ignored', paramType='path', required=True)
        .param('wc3', 'Ignored', paramType='path', required=True))

    @access.public
    def getIntents(self, params):
        config = girder.utility.config.getConfig()
        url = config.get('resources', {}).get('intentsServer')
        auth = None
        if (url.startswith('http') and len(url.split('/')) > 3 and
                '@' in url.split('/')[2]):
            parts = url.split('/')
            auth = parts[2].split('@', 1)[0]
            parts[2] = parts[2].split('@', 1)[1]
            url = '/'.join(parts)
        url += '?' + urllib.urlencode(params)
        request = urllib2.Request(url)
        if auth:
            request.add_header(
                'Authorization', 'Basic %s' % base64.encodestring(
                    auth).replace('\n', ''))
        cherrypy.response.headers['Content-Type'] = 'application/json'

        def resultFunc():
            yield urllib2.urlopen(request, timeout=10).read()

        return resultFunc
    getIntents.description = (
        Description('Get intents from the configured intents server.  This '
                    'function works around CORS issues.'))


def load(info):
    """
    Attach our API to the appropriate spot.

    :param info: a dictionary of server settings, of which the apiRoot value
                 is used.
    """
    info['apiRoot'].geoapp = GeoAppResource()
