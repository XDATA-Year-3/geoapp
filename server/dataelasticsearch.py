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
import threading
import time

from girder import logger


class ViaElasticsearch():

    epoch = datetime.datetime.utcfromtimestamp(0)

    def __init__(self, db=None, **params):
        """
        Create a connection to an Elasticsearch database that will return
        results for our standard find command.  params may contain the
        following values (only 'hosts' is required):
          hosts: a list of elasticsearch connections.  Example: [{'host':
        '10.1.93.172', 'port': 80, 'url_prefix': '/es94-103/instagram_remap',
        'timeout': 150}].  The timeout value can be a float or a
        urllib3.Timeout object, e.g., 'timeout': urllib3.Timeout(read=150,
        connect=10).  If the elasticsearch server is unreachable, it can take
        up to four times the connect timeout to actually timeout.
          filters: a list of additional filter terms to add to all searches.
        Example: [{'term': {'_type': 'baltimore'}}].
          livetime: the maximum duration in seconds to search from the present
        for new live data.  Any new data that is date stamped longer ago than
        this duration from the current time may be missed for up to this
        duration.
          datefield: the name of the field to use for restricting polling
        queries to recent data.
          tracktime: the maximum age in seconds of a client's polling
        information.  If a client fails to poll for live data for longer than
        this duration, a subsequent poll will fail and the client will need to
        requery for the whole data.

        :param db: the config-file name of the database.  Ignored, but could be
                   used for better logging.
        :param params: a dictionary of database parameters.  See above.
        """
        self.params = params.copy()
        self.dbparams = {key: params[key] for key in params if key in ['hosts']}
        self.db = None
        # This is an instagram-specific dictionary, and should be abstracted.
        # This list is not complete
        self.fieldName = {
            'rand1': '_score',
            'rand2': '_score',
            'msg_date': 'created_time',
            'msg': 'caption.text',
            'url': 'link',
            'latitude': 'location.latitude',
            'longitude': 'location.longitude',
            'user_id': 'user.id',
            'user_name': 'user.username',
            'user_fullname': 'user.full_name',
        }
        self.realtimeData = {
            'clients': {},
            'data': {},
            'id': 1,
            'lock': threading.RLock(),
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
        if not fields:
            fields = [field[0] for field in self.fieldTable]
        columns = {fields[col]: col for col in xrange(len(fields))}
        result = {
            'format': 'list',
            'fields': fields,
            'columns': columns,
        }
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
            'boost_mode': 'replace',
        }
        query['_source'] = {
            'include': [self.fieldName[field] for field in fields
                        if field in self.fieldName]
        }
        query['_source']['include'] = list(set(
            query['_source']['include'] + self.fieldName.values()))
        if not self.realTimeResultsInitialize(params, result, filters):
            return
        self.findFilters(filters, queries, params, query)
        if len(filters):
            query['query']['function_score']['filter'] = {
                'bool': {'must': filters}
            }
        if len(queries):
            query['query']['function_score']['query'] = {
                'bool': {'must': queries}
            }
        # The realtime option would be better implemented if the _timestamp
        # mapping is enabled with store: true in Elasticsearch.
        # It would be nice if we could have a 'distinct' clause for
        # elasticsearch, but this requires options that are not enabled.
        logger.info('Query: %s', json.dumps(query))
        try:
            res = db.search(body=json.dumps(query))
        except elasticsearch.ConnectionError as exc:
            logger.info('Database error %s', str(exc).strip())
            return None
        if not self.realtime:
            result['count'] = res['hits']['total'],
        execTime = time.time()
        # This is an instagram-specific line, and should be abstracted
        result['data'] = self.instagramToData(fields, res['hits']['hits'])
        self.realTimeResultsFinalize(params, result)
        curtime = time.time()
        logger.info(
            'Query time: %5.3fs for query, %5.3fs total, %d row%s',
            execTime - starttime, curtime - starttime, len(result['data']),
            's' if len(result['data']) != 1 else '')
        return result

    def findFilters(self, filters, queries, params, mainQuery):
        """
        Convert rest query parameters into Elasticsearch filters and queries.
        In general, we would rather have a filter than a query for ES, as they
        claim it is more efficient.  Some things much be queries, however (such
        as text search).

        :param filters: an array to store new ES filters in.
        :param queries: an array to store new ES queries in.
        :param params: the Rest query parameters.
        :param mainQuery: the main ES query.
        """
        for field in self.fieldTable:
            if self.realtime and field == '_id':
                continue
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
                    # Using a 'query_string' query rather than a 'match' query
                    # allows a lot of expression parsing.
                    # 'simple_query_string' is much like 'query_string' but
                    # closer to what I did for Postgres.  Weirdly,
                    # 'query_string' misses some words, and turning on the
                    # English analyzer does worse in the expected behavior than
                    # I would expect (for instance "coffee" doesn't match a
                    # string which contains "coffee.").  There are probably
                    # other options that would help.  Hashes are ignored, too.
                    queries.append({
                        'simple_query_string': {
                            'fields': [fieldName],
                            'query': value,
                            'default_operator': 'AND',
                            # 'analyzer': 'english',
                            # Only in query_string:
                            # 'allow_leading_wildcard': True,
                        }
                    })
                    # This is improved by having text analysis turned on.  We
                    # need to do more to generate logical processing, as
                    # presently it is a strick and process.
                    # fieldNameEng = fieldName + '.english'
                    # clause = {'query': value, 'operator': 'and'}
                    # queries.append({
                    #     'bool': {'should': [{
                    #         'match': {fieldName: clause}
                    #     }, {
                    #         'match': {fieldNameEng: clause}
                    #     }]}
                    # })
                elif fieldName == '_score' and suffix == '_max':
                    value = 1.0 - float(value) / 1000000000
                    mainQuery['query']['function_score']['min_score'] = value
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
                        filters.append({'range': {fieldName: {'lt': value}}})
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
                # We don't need the _id.
                # '_id':           res['_id'],
            }
            if inst.get('caption', None):
                item['msg'] = inst['caption']['text']
            item['msg_id'] = item['url'].strip('/').rsplit('/', 1)[-1]
            item['url'] = 'i/%s' % (item['msg_id'])
            data.append([item.get(field, None) for field in fields])
        return data

    def realTimeResultsFinalize(self, params, result):
        """
        Record the message ids that we have seen related to a realtime data
        query where we cannot specify only recent messages.  This also discards
        results from clients that appear to have been abandoned.

        :param result: the results from the database.  Modified if this is a
                       polling query.
        """
        if not self.realtime or 'nextId' not in result:
            return
        try:
            dataid = int(result['nextId'])
        except ValueError:
            return
        curtime = time.time()
        col = result['columns']['url']
        if '_id_min' not in params:
            with self.realtimeData['lock']:
                if dataid not in self.realtimeData['data']:
                    self.realtimeData['data'][dataid] = {
                        'urls': {}
                    }
                record = self.realtimeData['data'][dataid]
                urls = record['urls']
            for row in result['data']:
                urls[hash(row[col])] = True
            with self.realtimeData['lock']:
                record['update'] = curtime
                record['fullupdate'] = curtime
                record['fullcount'] = len(urls)
        else:
            with self.realtimeData['lock']:
                record = self.realtimeData['data'].get(dataid, None)
                if not record:
                    return
                updatefull = record.get('fullquery', False)
                urls = record['urls']
                if updatefull:
                    newurls = {}
                    record['fullupdate'] = curtime
                else:
                    newurls = urls
            for i in xrange(len(result['data']) - 1, -1, -1):
                row = result['data'][i]
                hval = hash(row[col])
                if hval in urls:
                    del result['data'][i]
                newurls[hval] = True
            with self.realtimeData['lock']:
                record['urls'] = newurls
                if updatefull:
                    record['fullcount'] = len(urls)
                record['update'] = curtime
        # Discard old records so that clients that have disconnected don't
        # consume memory.  This means that if you have a computer that goes to
        # sleep, you'll need to re-filter the results to make them live again.
        tracktime = float(self.params.get('tracktime', 3600))
        with self.realtimeData['lock']:
            for key in self.realtimeData['data'].keys():
                record = self.realtimeData['data'][key]
                if curtime - record['update'] > tracktime:
                    del self.realtimeData['data'][key]

    def realTimeResultsInitialize(self, params, result, filters):
        """
        If this is a realtime query, make sure we can simulating polling for
        new data.

        :param params: rest query parameters.
        :param result: result dictionary.  Possibly modified.
        :param filters: a list of filters which can be added to as needed.
        :returns: True to process request, False to send back nothing.
        """
        # This can be greatly simplified if we have a precise way of
        # identifying new data
        if not self.realtime:
            return True
        clientid = params.get('clientid', None)
        if params.get('_id_max', None):
            result['nextId'] = params['_id_max']
            return True
        if '_id_min' not in params:
            with self.realtimeData['lock']:
                nextid = result['nextId'] = self.realtimeData['id']
                self.realtimeData['id'] += 1
                if clientid:
                    if clientid in self.realtimeData['clients']:
                        oldid = self.realtimeData['clients'][clientid]
                        if oldid in self.realtimeData['data']:
                            del self.realtimeData['data'][oldid]
                    self.realtimeData['clients'][clientid] = nextid
        else:
            try:
                lastid = int(params['_id_min'])
            except ValueError:
                return False
            with self.realtimeData['lock']:
                if lastid not in self.realtimeData['data']:
                    return False
                nextid = result['nextId'] = self.realtimeData['id']
                self.realtimeData['id'] += 1
                if clientid:
                    if (clientid not in self.realtimeData['clients'] or
                            self.realtimeData['clients'][clientid] != lastid):
                        return False
                    self.realtimeData['clients'][clientid] = nextid
                self.realtimeData['data'][nextid] = self.realtimeData['data'][
                    lastid]
                del self.realtimeData['data'][lastid]
                record = self.realtimeData['data'][nextid]
                curtime = time.time()
                livetime = self.params.get('livetime', 1800)
                datefield = self.params.get('datefield', 'msg_date')
                record['fullquery'] = (
                    curtime - record['fullupdate'] > livetime or
                    len(record['urls']) > record['fullcount'] * 3)
                if not record['fullquery']:
                    filters.append({'range': {datefield: {
                        'gte': str(int(curtime - livetime))
                    }}})
        return True
