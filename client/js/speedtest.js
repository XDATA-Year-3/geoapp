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

geoapp.views.SpeedTestView = geoapp.View.extend({
    testVersion: 1,

    displayParams: {
        'display-tile-set': 'mapquest',
        'display-tile-opacity': 1
    },
    sizeFactors: [1, 1.5, 2, 3, 5, 7.5],
    tests: [
        {name: 'pload', type: 'pickup', phase: 'load'},
        {name: 'panim', type: 'pickup', phase: 'anim'},
        {name: 'lload', type: 'vector', phase: 'load'},
        {name: 'lanim', type: 'vector', phase: 'anim'},
        {name: 'bload', type: 'both',   phase: 'load', process: 'binned'},
        {name: 'banim', type: 'both',   phase: 'anim', process: 'binned'}
    ],

    events: {
        'click #ga-run-speed-test': function () {
            this.runTests();
        },
        'click #ga-stop-speed-test': function () {
            this.stopTests('stop');
        }
    },

    /* Initialize the view.
     *
     * @params settings: the initial settings.  This can include defaults for
     *                   the different control groups.
     */
    initialize: function (settings) {
        var view = this;
        this.initialSettings = settings;
        girder.cancelRestRequests('fetch');
        this.firstRender = true;
        this.render();
        $('#ga-run-speed-test').prop('disabled', true);
        $('#ga-stop-speed-test').prop('disabled', true);
        $.ajax({
            type: 'GET',
            url: 'https://data.kitware.com/api/v1/file/54f70b248d777f1460ce7315/download',
            dataType: 'json',
            success: function (data, status, jqxhr) {
                view.data = data;
                $('#ga-run-speed-test').prop('disabled', false);
            },
            error: function (jqxhr, status, error) {
                $('#ga-speed-test-error .error-message').text(error);
                $('#ga-speed-test-error').removeClass('hidden');
                $('#ga-speed-test-results').addClass('hidden');
            }
        });
        geoapp.View.prototype.initialize.apply(this, arguments);
        geoapp.map.fitBounds(null, 0);
    },

    /* Render the view.  This also prepares various controls if this is the
     * first load.
     */
    render: function () {
        var view = this;
        var test = this.$el.html(geoapp.templates.speedtest(
        )).on('ready.geoapp.view', function () {
            if (view.firstRender) {
                view.firstRender = false;
                geoapp.map.showMap('all', [], view.displayParams);
            }
            $('[title]').tooltip();
        });
        test.trigger($.Event('ready.geoapp.view', {relatedTarget: test}));
        return this;
    },

    /* Run tests. */
    runTests: function () {
        if ($('.ga-test-enable:not(:checked)').length === this.tests.length) {
            return;
        }
        $('#ga-speed-test-results tr').slice(2).remove();
        $('#ga-speed-test-results').removeClass('hidden');
        $('#ga-run-speed-test,#ga-test-comment,#ga-test-maximum,' +
            '.ga-test-enable').prop('disabled', true);
        $('#ga-stop-speed-test').prop('disabled', false);
        geoapp.map.fitBounds(null, 0);
        geoapp.map.animationAction('stop');
        var testsToRun = [];
        for (var i = 0; i < this.tests.length; i += 1) {
            testsToRun.push($('.ga-test-enable[ga-test-num=' + i + ']').is(
                ':not(:checked)') ? false : true);
        }
        this.testParams = {
            state: 'running',
            testNum: 0,    /* type index */
            sizePower: 4,  /* initial # of data points is 10^(sizePower) */
            sizeIndex: 0,  /* index within sizeFactors */
            times: [],
            results: {
                detailed: {},
                userAgent: navigator.userAgent,
                browserData: {
                    screenSize: {width: screen.width, height: screen.height},
                    windowSize: {
                        width: $(window).width(),
                        height: $(window).height()
                    }
                },
                version: this.testVersion,
                appVersion: geoapp.versionInfo
            },
            comment: $('#ga-test-comment').val(),
            maxPts: parseInt($('#ga-test-maximum').val()),
            testsToRun: testsToRun
        };
        var view = this;
        window.setTimeout(function () {
            view.nextTest();
        }, 1);
    },

    /* Run the next test, or stop the test.  The test parameters are in
     * this.testParams */
    nextTest: function () {
        var params = this.testParams,
            test = this.tests[params.testNum],
            view = this,
            row, results, skip = false, done = false;

        if (document.hidden === true) {
            this.stopTests('blur');
        }
        if (params.state !== 'running') {
            return;
        }
        skip = !params.testsToRun[params.testNum];
        switch (test.phase) {
            case 'load':
                if (skip && (!params.testsToRun[params.testNum + 1] ||
                        params.times.length)) {
                    break;
                }
                try {
                    results = this.loadTest();
                    /* gl.getError is slow, but it is outside of our timing
                     * loop, and it sometimes lets us not kill a browser quite
                     * so thoroughly. */
                    if (gl.getError()) {
                        console.log('gl error');
                        done = true;
                        return;
                    }
                } catch (err) {
                    console.error('Caught error');
                    console.log(err);
                    done = true;
                }
                if (done) {
                    this.stopTests('done');
                    return;
                }
                break;
            case 'anim':
                if (skip) {
                    break;
                }
                results = this.animationTest();
                break;
        }
        if (!results && !skip) {
            window.setTimeout(function () {
                view.nextTest();
            }, 0);
            return;
        }
        if (results) {
            if (!params.results[params.numPts]) {
                params.results[params.numPts] = {};
                params.results.detailed[params.numPts] = {};
            }
            params.results[params.numPts][test.name] = results.display;
            params.results.detailed[params.numPts][test.name] = results;
            if (!$('#ga-speed-test-results tr[numpts=' + params.numPts +
                   ']').length) {
                $('#ga-speed-test-results table tbody').append(
                    '<tr numpts="' + params.numPts + '"><td>' + params.numPts +
                    '</td></tr>');
            }
            row = $('#ga-speed-test-results tr[numpts=' + params.numPts + ']');

            while ($('td', row).length <= params.testNum + 1) {
                row.append('<td/>');
            }
            $('td', row).eq(params.testNum + 1).text(results.display);
        }
        params.times = [];
        params.testNum = (params.testNum + 1) % this.tests.length;
        if (!params.testNum) {
            params.sizeIndex += 1;
            if (params.sizeIndex >= this.sizeFactors.length) {
                params.sizeIndex = 0;
                params.sizePower += 1;
            }
        }
        if (results) {
            this.logTestResults(function () {
                view.nextTest();
            });
        } else {
            window.setTimeout(function () {
                view.nextTest();
            }, 1);
        }
    },

    /* Test how long it takes for showMap to render the a set of points or
     * lines.
     *
     * @returns: null to run the test again, or an object with value and
     *           display keys with the results of the test.
     */
    loadTest: function () {
        var params = this.testParams,
            test = this.tests[params.testNum],
            data, totaltime, i, starttime, stoptime;
        if (!params.times.length) {
            params.numPts = (Math.pow(10, params.sizePower) *
                      this.sizeFactors[params.sizeIndex]);
            if (params.numPts > params.maxPts && params.maxPts) {
                this.stopTests('done');
                return;
            }
            data = {
                format: this.data.format,
                columns: this.data.columns,
                datacount: params.numPts
            };
            if (params.numPts <= this.data.data.length) {
                data.data = this.data.data.slice(0, params.numPts);
            } else {
                data.data = this.data.data.slice(0);
                for (i = 0; data.data.length < params.numPts;
                     i = (i + 1) % this.data.data.length) {
                    data.data.push(this.data.data[i]);
                }
            }
            params.data = data;
            params.testStart = new Date().getTime();
            geoapp.map.maximumMapPoints = params.numPts;
            geoapp.map.maximumVectors = params.numPts;
        }
        starttime = new Date().getTime();
        geoapp.map.showMap(
            'taxi', params.data, $.extend({}, this.displayParams, {
                'display-type': test.type,
                'display-process': test.process || 'raw',
                'display-num-bins': 50
            }));
        stoptime = new Date().getTime();
        params.times.push(stoptime - starttime);
        if (params.times.length < 12 && stoptime - params.testStart < 10000) {
            return;
        }
        params.times.sort(function (a, b) {
            return a - b;
        });
        if (params.times.length > 5) {
            params.times = params.times.slice(1, params.times.length - 1);
        }
        for (i = totaltime = 0; i < params.times.length; i += 1) {
            totaltime += params.times[i];
        }
        totaltime /= params.times.length;
        return {
            value: totaltime,
            microsecPerPoint: totaltime * 1000 / params.numPts,
            times: params.times,
            display: sprintf('%5.3f s', totaltime / 1000)
        };
    },

    /* Test how long it takes to animate a series of frames.  We draw 200
     * frames or for 10 seconds, whichever comes first.  Our expected
     * sustainable framerate is the 99% worst case framerate.
     *
     * @returns: null to run the test again, or an object with value and
     *           display keys with the results of the test.
     */
    animationTest: function () {
        var params = this.testParams,
            test = this.tests[params.testNum],
            stoptime, fps, frametime;
        if (!params.times.length) {
            geoapp.map.showMap(
                'taxi', params.data, $.extend({}, this.displayParams, {
                    'display-type': test.type,
                    'display-process': test.process || 'raw',
                    'display-num-bins': 25
                }));
            geoapp.map.animate({
                cycle: 'day',
                'cycle-steps': 8,
                'cycle-substeps': 60,
                'cycle-steptime': 1000,
                playState: 'pause'
            });
            params.testStart = params.lastFrameTime = new Date().getTime();
            params.times.push(params.testStart);
            return;
        }
        geoapp.map.animationAction('step');
        stoptime = new Date().getTime();
        params.times.push(stoptime - params.lastFrameTime);
        params.lastFrameTime = stoptime;
        if (params.times.length < 200 + 1 &&
            stoptime - params.testStart < 10000) {
            return;
        }
        params.times = params.times.slice(1);
        params.times.sort(function (a, b) {
            return a - b;
        });
        frametime = params.times[parseInt(0.99 * params.times.length)];
        fps = 1000.0 / frametime;
        geoapp.map.animationAction('stop');
        return {
            value: fps,
            times: params.times,
            display: sprintf('%3.1f fps', fps)
        };
    },

    /* Stop the tests if they are running.
     *
     * @param reason: 'stop' if user clicked stop, 'blur' if lost window focus,
     *                'done' if finished.
     */
    stopTests: function (reason) {
        if (!this.testParams || this.testParams.state !== 'running') {
            return;
        }
        $('#ga-run-speed-test,#ga-test-comment,#ga-test-maximum,' +
            '.ga-test-enable').prop('disabled', false);
        $('#ga-stop-speed-test').prop('disabled', true);
        this.testParams.state = reason || 'stop';
        this.logTestResults();
    },

    /* Store the current test results into a girder item.  After we get a
     * receipt, optionally call another function.
     *
     * @param callback: function to call when we know the results have been
     *                  stored.
     */
    logTestResults: function (callback) {
        var view = this,
            path = 'geoapp/reporttest',
            params = {};

        var metadata = this.testParams.results;
        metadata.state = this.testParams.state;
        metadata.comment = this.testParams.comment;
        if (this.testParams.logId) {
            path += '/' + this.testParams.logId;
        } else {
            params.name = 'Speed Test ' +
                moment().format('YYYY-MM-DD HH:mm:ss');
            if (this.testParams.comment) {
                params.name += ' - ' + this.testParams.comment;
            }
        }
        geoapp.restRequest({
            path: path + '?' + $.param(params),
            type: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify(metadata)
        }).done(function (item) {
            view.testParams.logId = item._id;
            if (callback) {
                callback();
            }
        });
    }
});

/* Given an appropriate route, redirect to the SpeedTestView.
 *
 * @params params: query parameters specified as part of the route.
 */
function routeToSpeedTest(params) {
    geoapp.events.trigger(
        'ga:navigateTo', geoapp.views.SpeedTestView, _.extend({
        }, params || {}));
}

geoapp.router.route('speedtest', 'speedtest', routeToSpeedTest);
