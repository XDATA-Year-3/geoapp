/* Copyright 2015 Kitware Inc.
 *
 *  Licensed under the Apache License, Version 2.0 ( the "License" );
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

geoapp.dataHandlers = {};

geoapp.DataHandler = function (arg) {
    'use strict';

    if (!(this instanceof geoapp.DataHandler)) {
        return new geoapp.DataHandler(arg);
    }
    arg = arg || {};

    var m_verbose = 1;

    /* maximumDataPoints defaults to the maximum of maximumMapPoints and
     * maximumVectors from the geoapp.map object. */
    this.maximumDataPoints = null;
    /* pageDataPoints to null to load everything in one batch (to use
     * maximumDataPoints).  If oneSmallPage is true, pageDataPoints are loaded,
     * then all of the rest of the data in a second query.  If false,
     * pageDataPoints are loaded at a time until all of the data is loaded. */
    this.pageDataPoints = 10000;
    this.oneSmallPage = true;

    /* Set or get the current verbosity for console logging.
     *
     * @param verbose: if specified, set the verbosity to this integer.
     * @returns: the current verbosity.
     */
    this.verbosity = function (verbose) {
        if (verbose !== undefined) {
            m_verbose = parseInt(verbose);
        }
        return m_verbose;
    };

    /* Setup parameters for a chain of rest calls to obtains data.  The options
     * consist of:
     *  params: a list of parameters to pass to the rest call.  If they are
     *      not set, the limit and fields keys in this dictionary are set.
     *  maxcount: unset to auto-pick values, otherwise the maximum number of
     *      points to retrieve.
     *  data: the data that has been fetched.  This is extended as more data
     *      arrives.
     *  startTime: the epoch in ms when the first call to this function was
     *      made.
     *  display: a list of parameters that affect the display but not the
     *      selected data.
     *
     * @param options: a dictionary of options to augment as needed.  Modified.
     * @param desc: description.
     * @param maxcount: the maximum number of rows to retreive.
     */
    this.setupRequestOptions = function (options, desc, maxcount) {
        if (!options.maxcount) {
            if (m_verbose >= 1) {
                console.log(options);
            }
            options.maxcount = maxcount;
            options.params.offset = 0;
            options.params.format = 'list';
            options.data = null;
            options.startTime = new Date().getTime();
            options.callNumber = 0;
            options.requestTime = options.showTime = 0;
            options.origMapParams = geoapp.map.getMapParams(desc);
            options.description = desc;
        }
        if (!options.params.limit) {
            options.params.limit = Math.min(
                this.pageDataPoints || options.maxcount, options.maxcount);
        } else if (this.oneSmallPage) {
            options.params.limit = options.maxcount - options.params.offset;
        }
        options.requestTime -= new Date().getTime();
        if (m_verbose >= 1) {
            console.log(desc + ' request ' + (new Date().getTime() -
                                             options.startTime));
        }
    };

    /* Process the data as it comes in from a rest end point.
     *
     * @param options: the request options.
     * @param resp: the ajax response.
     * @param showfunc: a function to show the data.  It is passed (options).
     * @param loadfunc: a function to call after the data has been processed
     *                  and shown.  It is passed (options, callNext, moreData)
     *                  where callNext is true if more data should be fetched,
     *                  and moreData is true if there is probably more data
     *                  that could be loaded.  If callNext is true, moreData is
     *                  always true.
     */
    this.processRequestData = function (options, resp, showfunc, loadfunc) {
        if (!options.data) {
            options.data = resp;
        } else {
            $.merge(options.data.data, resp.data);
            options.data.datacount += resp.datacount;
        }
        options.requestTime += new Date().getTime();
        options.showTime -= new Date().getTime();
        if (m_verbose >= 1) {
            console.log(options.description + ' show ' +
                        (new Date().getTime() - options.startTime));
        }
        var currentMapParams = geoapp.map.getMapParams(options.desc);
        if (!_.isEqual(currentMapParams, options.origMapParams)) {
            options.display = currentMapParams;
        }
        showfunc.call(this, options);
        options.callNumber += 1;
        options.showTime += new Date().getTime();
        var moreData = (options.data.datacount < options.data.count ||
            (resp.datacount === options.params.limit &&
            options.data.count === undefined));
        var callNext = (moreData && options.data.datacount < options.maxcount);
        if (m_verbose >= 1) {
            console.log(
                options.description + (callNext ? ' next ' : ' last ') +
                (new Date().getTime() - options.startTime) + ' ' +
                options.data.datacount + ' ' + options.data.count +
                ' requestTime ' + options.requestTime + ' showTime ' +
                options.showTime);
        }
        if (callNext) {
            options.params.offset += resp.datacount;
        }
        loadfunc.call(this, options, callNext, moreData);
        geoapp.activityLog.logActivity('load_data', 'datahandler', {
            data: options.description,
            params: options.params,
            complete: !callNext
        });
    };

    /* Set or clear the loading animation.
     *
     * @param elem: a jquery selector for the element containing the loading
     *              animation.
     * @param hidden: true to hide the animation, false to show it.
     * @param first: true if this is the first batch of data, false if not.
     */
    this.loadingAnimation = function (elem, hidden, first) {
        elem = $(elem);
        elem.toggleClass('hidden', !!hidden);
        if (!hidden) {
            elem.toggleClass('first-load', !!first);
            elem.toggleClass('second-load', !first);
            /* Restart the animation */
            $('i', elem).removeClass('animate-spin');
            window.setTimeout(function () {
                $('i', elem).addClass('animate-spin');
            }, 1);
        }
    };

    /* Show a message about how much data has been loaded.
     *
     * @param selector: jquery selector of are where the laoding message shou;d
     *                  be shown.
     * @param count: number of items loaded.
     * @param callNext: true if more data is going to be fetched.
     * @param modeData: true if there is more data that could be loaded.
     * @param singleItem: single form of item loaded (e.g., 'trip').
     * @param pluralItem: plural form of item loaded (e.g., 'trips').
     */
    this.loadedMessage = function (selector, count, callNext, moreData,
                                   singleItem, pluralItem) {
        var shortMsg = sprintf('%s %d', callNext ? 'Loading' : (
            moreData ? 'First' : 'All'), count);
        var longMsg = sprintf('Load%s %s %d %s', callNext ? 'ing' : 'ed',
                               moreData ? 'first' : 'all', count,
                              count === 1 ? singleItem : pluralItem);
        if (!callNext && moreData) {
            longMsg += sprintf('.  Increase Max %s to load more data.',
                pluralItem[0].toUpperCase() + pluralItem.substring(1));
        }
        $(selector).text(shortMsg).attr('title', longMsg)
            .tooltip().attr('data-original-title', longMsg)
            .tooltip('fixTitle');
    };
};

/* -------- taxi data handler -------- */

geoapp.dataHandlers.taxi = function (arg) {
    'use strict';
    var datakey = 'taxi';

    if (!(this instanceof geoapp.dataHandlers[datakey])) {
        return new geoapp.dataHandlers[datakey](arg);
    }
    arg = arg || {};
    geoapp.DataHandler.call(this, arg);

    this.datakey = datakey;

    /* Replace or add to the taxi data used for the current map.
     *
     * @param: options: a dictionary with the parameters to use for fetching
     *                  data and the state of the process.  See
     *                  setupRequestOptions for more details.
     */
    this.dataLoad = function (options) {
        this.setupRequestOptions(options, datakey, (
            options.params.max_trips || this.maximumDataPoints ||
            Math.max(geoapp.map.maximumMapPoints,
                     geoapp.map.maximumVectors)));
        if (!options.params.fields) {
            options.params.fields = '' + //'medallion,hack_license,' +
                'pickup_datetime,pickup_longitude,pickup_latitude,' +
                'dropoff_datetime,dropoff_longitude,dropoff_latitude';
        }
        geoapp.cancelRestRequests(datakey + 'taxidata');
        this.loadingAnimation('#ga-taxi-loading', false,
                              !options.params.offset);
        var xhr = geoapp.restRequest({
            path: 'geoapp/taxi', type: 'GET', data: options.params
        }).done(_.bind(function (resp) {
            this.processRequestData(options, resp, this.dataShow,
                                    this.dataLoaded);
        }, this));
        xhr.girder = {taxidata: true};
    };

    /* Show the taxi data after it has been fetched.
     *
     * @param options: the request options.
     */
    this.dataShow = function (options) {
        geoapp.map.setCycleDateRange(options.params, 'pickup_datetime_min',
                                     'pickup_datetime_max');
        geoapp.map.showMap(options.description, options.data, options.display);
    };

    /* Load more taxi data or indicated that we are finished loading.
     *
     * @param options: the request options.
     * @param callNext: true if more data is needed.
     * @param moreData: true if more data is available.
     */
    this.dataLoaded = function (options, callNext, moreData) {
        this.loadedMessage('#ga-points-loaded', options.data.datacount,
                           callNext, moreData, 'trip', 'trips');
        if (callNext) {
            this.dataLoad(options);
        } else {
            this.loadingAnimation('#ga-taxi-loading', true);
        }
    };
};

inherit(geoapp.dataHandlers.taxi, geoapp.DataHandler);

/* -------- instagra, data handler -------- */

geoapp.dataHandlers.instagram = function (arg) {
    'use strict';
    var datakey = 'instagram';

    if (!(this instanceof geoapp.dataHandlers[datakey])) {
        return new geoapp.dataHandlers[datakey](arg);
    }
    arg = arg || {};
    geoapp.DataHandler.call(this, arg);

    this.datakey = datakey;

    /* Replace or add to the instagram data used for the current map.
     *
     * @param: options: a dictionary with the parameters to use for fetching
     *                  data and the state of the process.  See
     *                  setupRequestOptions for more details.
     */
    this.dataLoad = function (options) {
        this.setupRequestOptions(options, 'instagram', (
            options.params.max_instagrams || this.maximumDataPoints ||
            geoapp.map.maximumMapPoints));
        if (!options.params.fields) {
            options.params.fields = '' +
                'posted_date,caption,image_url,latitude,longitude';
        }
        geoapp.cancelRestRequests('instagramdata');
        this.loadingAnimation('#ga-instagram-loading', false,
                              !options.params.offset);
        var xhr = geoapp.restRequest({
            path: 'geoapp/instagram', type: 'GET', data: options.params
        }).done(_.bind(function (resp) {
            this.processRequestData(options, resp, this.dataShow,
                                    this.dataLoaded);
        }, this));
        xhr.girder = {instagramdata: true};
    };

    /* Show the instagram data after it has been fetched.
     *
     * @param options: the request options.
     */
    this.dataShow = function (options) {
        /* Note that this competes with the taxi setCycleDateRange, and I need
         * to do something other than let the last one win. */
        geoapp.map.setCycleDateRange(options.params, 'posted_date_min',
                                     'posted_date_max');
        geoapp.map.showMap(options.description, options.data, options.display);
        /* Hide the instagram results panel if there is no data.  Show it with
         * a small quantity of data if there is data. */
        if (!options.data || !options.data.data || !options.data.data.length) {
            $('#ga-instagram-results-panel').addClass('hidden');
            return;
        }
        var table = $('#ga-instagram-results-table');
        table.attr('count', options.data.data.length);
        /* If the offset is non-zero, we've already started displaying the
         * results. */
        if (options.params.offset) {
            return;
        }
        $('#ga-instagram-results-panel').removeClass('hidden');
        $('#ga-instagram-results-table tr:has(td)').remove();
        $('#ga-instagram-results .results-table').scrollTop(0);
        if (this.instagramTable()) {
            geoapp.infiniteScroll('#ga-instagram-results .results-table',
                                  this.instagramTable, this);
        }
    };

    /* Load more instagram data or indicated that we are finished loading.
     *
     * @param options: the request options.
     * @param callNext: true if more data is needed.
     * @param moreData: true if more data is available.
     */
    this.dataLoaded = function (options, callNext, moreData) {
        this.loadedMessage('#ga-inst-points-loaded', options.data.datacount,
                           callNext, moreData, 'message', 'messages');
        if (callNext) {
            this.dataLoad(options);
        } else {
            this.loadingAnimation('#ga-instagram-loading', true);
        }
    };

    /* Append rows to the instagram table.
     *
     * @return: true if there is more data. */
    this.instagramTable = function () {
        var table = $('#ga-instagram-results-table'),
            page = 100,
            layer = geoapp.map.getLayer(this.datakey),
            data = layer.data(),
            moreData = false;
        if (!data || !data.data || !data.data.length) {
            return moreData;
        }
        var current = $('tr:has(td)', table).length;
        var date_column = data.columns.posted_date,
            caption_column = data.columns.caption,
            url_column = data.columns.url;
        $('.ga-more-results', table).remove();
        /* We may want to apply another filter to the data here */
        for (var i = current; i < data.data.length && i < current + page;
                i += 1) {
            table.append($('<tr/>')
                .attr({
                    item: i,
                    url: data.data[i][url_column]
                })
                .append($('<td/>').text(moment(data.data[i][date_column])
                    .format('YY-MM-DD HH:mm')))
                .append($('<td/>').text(data.data[i][caption_column])
                    .attr('title', data.data[i][caption_column]))
            );
        }
        if (current + page < data.data.length) {
            moreData = true;
            table.append($('<tr/>').attr({
                class: 'ga-more-results'
            }).append($('<td/>').attr({
                colspan: 2
            }).text('More ...')));
        }
        //TODO:: switch to a bootstrap tooltip with the picture and caption,
        // highlight the point hovered over, zoom to that point if clicked,
        // sort data table by date, inverse date, or original
        return moreData;
    };
};

inherit(geoapp.dataHandlers.instagram, geoapp.DataHandler);
