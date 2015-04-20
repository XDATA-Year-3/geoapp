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
     *                  and shown.  It is passed (options, callNext) where
     *                  callNext is true if more data should be fetched.
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
        var callNext = ((options.data.datacount < options.data.count ||
            (resp.datacount == options.params.limit &&
            options.data.count === undefined)) &&
            options.data.datacount < options.maxcount);
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
        loadfunc.call(this, options, callNext);
        geoapp.activityLog.logActivity('load_data', 'datahandler', {
            data: options.description,
            params: options.params,
            complete: !callNext
        });
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
        $('#ga-taxi-loading').removeClass('hidden')
            .toggleClass('first-load', !options.params.offset)
            .toggleClass('second-load', !!options.params.offset);
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
     */
    this.dataLoaded = function (options, callNext) {
        var title = sprintf('Loaded %d trips', options.data.datacount);
        $('#ga-points-loaded').text(sprintf(
            'Loaded %d', options.data.datacount)).attr('title', title)
            .tooltip().attr('data-original-title', title)
            .tooltip('fixTitle');
        if (callNext) {
            this.dataLoad(options);
        } else {
            $('#ga-taxi-loading').addClass('hidden');
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
        $('#ga-instagram-loading').removeClass('hidden')
            .toggleClass('first-load', !options.params.offset)
            .toggleClass('second-load', !!options.params.offset);
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
        //DWM::
        //geoapp.map.setCycleDateRange(options.params, 'pickup_datetime_min',
        //                             'pickup_datetime_max');
        geoapp.map.showMap(options.description, options.data, options.display);
        /* debug here */
        var d = [];
        for (var i = 0; i < options.data.data.length && i < 100; i += 1) {
            d.push(options.data.data[i][1]);
        }
        console.log(d); //DWM::
    };

    /* Load more instagram data or indicated that we are finished loading.
     *
     * @param options: the request options.
     * @param callNext: true if more data is needed.
     */
    this.dataLoaded = function (options, callNext) {
        var title = sprintf('Loaded %d messages', options.data.datacount);
        $('#ga-inst-points-loaded').text(sprintf(
            'Loaded %d', options.data.datacount)).attr('title', title)
            .tooltip().attr('data-original-title', title)
            .tooltip('fixTitle');
        if (callNext) {
            this.dataLoad(options);
        } else {
            $('#ga-instagram-loading').addClass('hidden');
        }
    };
};

inherit(geoapp.dataHandlers.instagram, geoapp.DataHandler);
