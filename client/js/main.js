var geoapp = girder;
var app;

moment.suppressDeprecationWarnings = true;

geoapp.App = geoapp.View.extend({
    initialize: function (settings) {
        geoapp.restRequest({
            path: 'user/me'
        }).done(_.bind(function (user) {
            this.globalNavView = new geoapp.views.LayoutGlobalNavView({
                parentView: this
            });
            this.render();
            // Once we've rendered the layout, we can start up the routing.
            Backbone.history.start({
                pushState: false
            });
        }, this));
        geoapp.events.on('ga:navigateTo', this.navigateTo, this);
    },
    render: function () {
        return this;
    },
    /* Changes the current body view to the view class specified by view.
     *
     * @param view The view to display in the body.
     * @param [settings={}] Settings to pass to the view initialize() method.
     */
    navigateTo: function (view, settings) {
        var container = this.$('#app-container');

        this.globalNavView.deactivateAll();

        settings = settings || {};

        if (view) {
            if (this.bodyView) {
                this.bodyView.destroy();
            }

            settings = _.extend(settings, {
                el: this.$('#app-container'),
                parentView: this
            });

            /* We let the view be created in this way even though it is
             * normally against convention. */
            /*jshint -W055 */
            // jscs:disable requireCapitalizedConstructors
            this.bodyView = new view(settings);
            // jscs:enable requireCapitalizedConstructors
        } else {
            console.error('Undefined page.');
        }
        return this;
    },

});

/* The navigation is of the form #(primary/route)?(section)=(params).  This
 * updates one of the query parameters to contain an encoded dictionary of
 * parameters.
 *
 * @param base: new base navigation if not null or undefined.
 * @param section: the base name of the query parameter.
 * @param params: a dictionary to encode.
 */
geoapp.updateNavigation = function (base, section, params) {
    var curRoute = Backbone.history.fragment || '',
        routeParts = geoapp.dialogs.splitRoute(curRoute),
        queryString = geoapp.parseQueryString(routeParts.name);
    if (base === null || base === undefined) {
        base = routeParts.base;
    }
    if (queryString[section]) {
        delete queryString[section];
    }
    if (params) {
        queryString[section] = $.param(params);
    }
    var unparsedQueryString = $.param(queryString);
    if (unparsedQueryString.length > 0) {
        unparsedQueryString = '?' + unparsedQueryString;
    }
    geoapp.router.navigate(base + unparsedQueryString);
};

/* Parse a JSON string to an object, returning an empty object on any error.
 *
 * @param jsonValue: the JSON value.
 * @returns: the parsed object or an empty object.
 */
geoapp.parseJSON = function (jsonValue)  {
    try {
        return JSON.parse(jsonValue);
    } catch (err) {
        return {};
    }
}

/* I'd rather use the girder function, but as of girder 1.2.1, the function was
 * defective. */
geoapp.parseQueryString = function (queryString) {
    var params = {};
    if (queryString) {
        _.each(queryString.split(/&/g), function (el, i) {
            var aux = el.split('='), o = {}, val;
            if (aux.length > 1) {
                val = decodeURIComponent(el.substr(aux[0].length+1));
            }
            params[decodeURIComponent(aux[0])] = val;
        });
    }
    return params;
};

var geo_map = null, drawTimer = null, drawQueued = false;

function replaceMapData(options) {
    if (!options.maxcount) {
        console.log(options); //DWM::
        options.maxcount = 250000;
        options.params.offset = 0;
        options.params.format = 'list';
        options.data = null;
        options.startTime = (new Date).getTime();
    }
    if (!options.params.limit) {
        options.params.limit = 50000;
    }
    if (!options.params.fields) {
        options.params.fields = 'medallion, hack_license, ' +
            'pickup_datetime, pickup_longitude, pickup_latitude, ' +
            'dropoff_datetime, dropoff_longitude, dropoff_latitude';
    }
    console.log('request '+((new Date).getTime()-options.startTime)); //DWM::
    geoapp.cancelRestRequests('mapdata');
    var xhr = geoapp.restRequest({
        path: 'taxi', type: 'GET', data: options.params
    }).done(_.bind(function (resp) {
        if (!options.data) {
            options.data = resp;
        } else {
            $.merge(options.data.data, resp.data);
            options.data.datacount += resp.datacount;
        }
        console.log('show '+((new Date).getTime()-options.startTime)); //DWM::
        showMap(options.data);
        if ((options.data.datacount < options.data.count ||
                (resp.datacount == options.params.limit &&
                 options.data.count == undefined)) &&
                options.data.datacount < options.maxcount) {
            options.params.offset += resp.datacount;
            console.log('next '+((new Date).getTime()-options.startTime)+' '+options.data.datacount+' '+options.data.count); //DWM::
            replaceMapData(options);
        } else {
            console.log('last '+((new Date).getTime()-options.startTime)+' '+options.data.datacount+' '+options.data.count); //DWM::
        }
    }, this));
    xhr.girder = {mapdata: true};
}

function showMap(data) {
    if (!geo_map) {
        geo_map = geo.map({
            node: '#ga-main-map',
            center: {
                x: -73.978165,
                y: 40.757977
            },
            zoom: 10,
        });
        geo_map.createLayer('osm', {
            baseUrl: 'http://otile1.mqcdn.com/tiles/1.0.0/map/',
            //baseUrl: 'http://tile.openstreetmap.org/'
            zoomDelta: 3.5,
        });
        geo_layer = geo_map.createLayer('feature');
        geo_feature = geo_layer.createFeature('point', {selectionAPI: true})
    }
    if (data && data.data) {
        geo_feature.data(data.data)
            .style({
                fillColor: 'black',
                fillOpacity: 0.05,
                stroke: false,
                radius: 5,
            })
            .position(function (d) {
                return {
                    x: d[data.columns['pickup_longitude']],
                    y: d[data.columns['pickup_latitude']]
                };
            });
    }
    geo_map.draw();
}

function triggerDraw(fromTimer) {
    if (fromTimer) {
        drawTimer = null;
        if (!drawQueued) {
            return;
        }
    }
    if (!drawTimer) {
        geo_map.draw();
        drawQueued = false;
        drawTimer = window.setTimeout(function() {
            triggerDraw(true);
        }, 100);
        return;
    } else {
        drawQueued = true;
    }
}

/* Run this when everything else is loaded */
$(function () {
    girder.apiRoot = 'api/v1';
    app = new geoapp.App({el: 'body', parentView: null});
});

/* TODO:
 * - encode and restore map positions via navigation (encode whenever update or
 * filter is called).
 */
