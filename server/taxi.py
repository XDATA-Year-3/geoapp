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
import urllib

import girder.api.rest
from girder import logger
from girder.api import access
from girder.api.describe import Description


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

    def __init__(self, dbUri=None):
        self.dbUri = dbUri
        db_connection = self.getDbConnection()
        self.database = db_connection.get_default_database()
        self.trips = self.database['trips']

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
        :param sort: a tuple of the form (key, direction).
        :param fields: a list of fields to return, or None for all fields.
        :returns: a dictionary of results.
        """
        findParam = {}
        for field in FieldTable:
            if field in params:
                value = self.getParamValue(field, params[field])
                findParam[field] = value
            if field + '_min' in params:
                value = self.getParamValue(field, params[field + '_min'])
                if field not in findParam:
                    findParam[field] = {}
                if isinstance(findParam[field], dict):
                    findParam[field]['$gte'] = value
            if field + '_max' in params:
                value = self.getParamValue(field, params[field + '_max'])
                if field not in findParam:
                    findParam[field] = {}
                if isinstance(findParam[field], dict):
                    findParam[field]['$lt'] = value
        query = {}
        for key in findParam:
            query[self.KeyTable.get(key, key)] = findParam[key]
        sort = [(self.KeyTable.get(key, key), dir) for (key, dir) in sort]
        if fields:
            fields = {self.KeyTable.get(key, key): 1 for key in fields}
            fields['_id'] = 0
        logger.info('Query %r', ((query, offset, limit, sort, fields), ))
        cursor = self.trips.find(spec=query, skip=offset, limit=limit,
                                 sort=sort, timeout=False, fields=fields)
        total = cursor.count()
        epoch = datetime.datetime.utcfromtimestamp(0)
        dt = datetime.datetime
        result = {'count': total, 'data': [{
            self.RevTable.get(k, k):
            v if not isinstance(v, dt) else int((v-epoch).total_seconds())
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


class TaxiViaTangeloService():

    KeyTable = {
        'medallion': 'medallion_deanon',
        'hack_license': 'hack_license_deanon',
    }
    RevTable = {v: k for k, v in KeyTable.items()}

    def __init__(self):
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


class Taxi(girder.api.rest.Resource):
    """API endpoint for taxi data."""

    def __init__(self):
        self.resourceName = 'taxi'
        self.route('GET', (), self.find)
        self.access = {
            'mongo': (TaxiViaMongo, {}),
            'mongofull': (TaxiViaMongo, {
                'dbUri': 'mongodb://parakon:27017/taxifull'}),
            'tangelo': (TaxiViaTangeloService, {}),
        }

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
            print result['data'][0]  # ##DWM::
        else:
            if result.get('format', '') == 'list':
                if 'data' in result:
                    result['data'] = [{
                        result['fields'][col]: row[col]
                        for col in xrange(len(row))} for row in result['data']]
                result['format'] = 'dict'
                del result['columns']
        # We could let Girder convert the results into JSON, but it is
        # margninally faster to dump the JSON ourselves, since we can exclude
        # sorting and reduce whitespace
        #  return result

        def resultFunc():
            yield json.dumps(
                result, check_circular=False, separators=(',', ':'),
                sort_keys=False, default=str)

        cherrypy.response.headers['Content-Type'] = 'application/json'
        return resultFunc

    find.description = (
        Description('Get a set of taxi data.')
        .param('source', 'Database source (default mongo).', required=False,
               enum=['mongo', 'mongofull', 'tangelo'])
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


def load(info):
    """
    Attach our API to the appropriate spot.

    :param info: a dictionary of server settings, of which the apiRoot value
                 is used.
    """
    info['apiRoot'].taxi = Taxi()
