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

# This file contains classes and code specific to accessing Elasticsearch
# databases.

import datetime
import dateutil.parser
import elasticsearch
import json
import time

from girder import logger


class ViaElasticsearch():

    epoch = datetime.datetime.utcfromtimestamp(0)

    def __init__(self, db=None, **params):
        """
        Create a connection to an Elasticsearch database that will return
        results for our standard find command.  A sample 'hosts' record is
        [{'host': '10.1.93.172', 'port': 80, 'url_prefix':
        '/es94-103/instagram_remap', 'timeout': 150}].  A sample 'filters'
        parameter is [{'term': {'_type': 'baltimore'}}].

        :param db: the config-file name of the database.  Ignored, but could be
                   used for better logging.
        :param params: a dictionary of database parameters.  'hosts' contains
                       the elastic search connection information.  'filters'
                       contains a list additional filter clauses to add to all
                       queries.  Both of these must be lists if present.  See
                       above.
        """
        self.params = params.copy()
        self.dbparams = {key: params[key] for key in params if key in ['hosts']}
        self.db = None
        # This list is not complete
        self.fieldName = {
            'rand1': '_score',
            'rand2': '_score',
            'msg_date': 'created_time',
            'msg': 'caption.text',
            'url': 'link',
            'latitude': 'location.latitude',
            'longitude': 'location.longitude',
        }

    def connect(self):
        """
        Connect to the database.

        :return: a database object.
        """
        if not self.db:
            self.db = elasticsearch.Elasticsearch(**self.dbparams)
        return self.db

    def find(self, params={}, limit=50, offset=0, sort=None, fields=None,
             **kwargs):
        """
        Get data from an elasticsearch database.

        :param params: a dictionary of query restrictions.  See the field
                       table(s).  For values that aren't of type 'text' or
                       'search', we also support (field)_min and (field)_max
                       parameters, which are inclusive and exclusive
                       respectively.  'search' adds a (field)_search parameter
                       which will perform a tsquery search.
        :param limit: default limit for the data.
        :param offset: default offset for the data.
        :param sort: a list of tuples of the form (key, direction).
        :param fields: a list of fields to return, or None for all fields.
        :returns: a dictionary of results.
        """
        db = self.connect()
        starttime = time.time()
        filters = [{'exists': {'field': 'location.longitude'}}]
        if 'filters' in self.params:
            filters.extend(self.params['filters'])
        queries = []
        query = {
            'size': limit,
            'from': offset,
            'query': {}
        }
        query['query']['function_score'] = {
            'random_score': {'seed': 1},
        }
        if not fields:
            fields = [field[0] for field in self.fieldTable]
        query['_source'] = {
            'include': [self.fieldName[field] for field in fields
                        if field in self.fieldName]
        }
        query['_source']['include'] = list(set(
            query['_source']['include'] +
            ['user.username', 'user.full_name', 'user.id', 'created_time',
             'link', 'location.latitude', 'location.longitude',
             'caption.text']))
        self.findFilters(filters, queries, params)
        if len(filters):
            query['query']['function_score']['filter'] = {
                'bool': {'must': filters}
            }
        if len(queries):
            query['query']['function_score']['query'] = {
                'bool': {'must': queries}
            }
        # The realtime options need to be implemented.  I don't currently know
        # how to sort Elasticsearch data on ingest order.  Elasticsearch has an
        # _id field of the form (integer)_(integer).  I think the leading
        # integer is monotonic (I could be wrong) and related to ingest order,
        # but I don't know how to sort on the numeric value of this.  Also, I
        # need to add a 'distinct' clause to only get each message once.
        logger.info('Query: %s', json.dumps(query))
        res = db.search(body=json.dumps(query))
        columns = {fields[col]: col for col in xrange(len(fields))}
        result = {
            'format': 'list',
            'fields': fields,
            'columns': columns,
            'count': res['hits']['total'],
        }
        execTime = time.time()
        result['data'] = self.instagramToData(fields, res['hits']['hits'])
        curtime = time.time()
        logger.info(
            'Query time: %5.3fs for query, %5.3fs total, %d row%s',
            execTime - starttime, curtime - starttime, len(result['data']),
            's' if len(result['data']) != 1 else '')
        return result

    def findFilters(self, filters, queries, params):
        """
        Convert rest query parameters into Elasticsearch filters and queries.
        In general, we would rather have a filter than a query for ES, as they
        claim it is more efficient.  Some things much be queries, however (such
        as text search).

        :param filters: an array to store new ES filters in.
        :param queries: an array to store new ES queries in.
        :param params: the Rest query parameters.
        """
        for field in self.fieldTable:
            for suffix in ['', '_min', '_max', '_search']:
                if field + suffix not in params:
                    continue
                value = params[field + suffix]
                dtype = self.fieldTable[field][0]
                fieldName = self.fieldName.get(field, field)
                if suffix == '_search':
                    if dtype != 'search':
                        continue
                    if isinstance(value, (int, float, long)):
                        value = str(value)
                    # This is improved by having text analysis turned on.  We
                    # need to do more to generate logical processing, as
                    # presently it is a strick and process.
                    fieldNameEng = fieldName + '.english'
                    clause = {'query': value, 'operator': 'and'}
                    queries.append({
                        'bool': {'should': [{
                            'match': {fieldName: clause}
                        }, {
                            'match': {fieldNameEng: clause}
                        }]}
                    })
                else:
                    if dtype == 'date':
                        value = int((dateutil.parser.parse(value) - self.epoch)
                                    .total_seconds())
                        # Elasticsearch is expecting epoch seconds in a string
                        value = str(value)
                    elif dtype in ('int', 'bigint'):
                        value = int(value)
                    elif dtype == 'float':
                        value = float(value)
                    else:
                        value = str(value)
                    if suffix == '_min':
                        filters.append({'range': {fieldName: {'gte': value}}})
                    elif suffix == '_max':
                        if (not len(filters) or not filters[-1].get(
                                'range', None) or not filters[-1][
                                'range'].get(fieldName, None)):
                            filters.append({'range': {fieldName: {}}})
                        filters[-1]['range'][fieldName]['lt'] = value
                    else:
                        filters.append({'term': {fieldName: value}})

    def instagramToData(self, fields, results):
        """
        Convert elasticsearch instagram results into our data list format.

        :param fields: the fields we want to keep (the columns for our data).
        :param results: the ['hits']['hits'] part of the elasticsearch result.
        :return: a list of the data in our format.
        """
        data = []
        if not len(results):
            return data
        for res in results:
            inst = res['_source']
            item = {
                'user_name':     inst.get('user', {}).get('username', None),
                'user_fullname': inst.get('user', {}).get('full_name', None),
                'user_id':       inst.get('user', {}).get('id', None),
                'msg_date':      float(inst['created_time']) * 1000,
                'url':           inst['link'],
                'latitude':      inst['location']['latitude'],
                'longitude':     inst['location']['longitude'],
                'rand1':         int((1 - res['_score']) * 1e9),
                'rand2':         int((1 - res['_score']) * 1e18) % 1000000000,
                '_id':           res['_id'],
            }
            if inst.get('caption', None):
                item['msg'] = inst['caption']['text']
            item['msg_id'] = item['url'].strip('/').rsplit('/', 1)[-1]
            item['url'] = 'i/%s' % (item['msg_id'])
            data.append([item.get(field, None) for field in fields])
        return data
