var geoapp = girder;
var app;

geoapp.App = geoapp.View.extend({
    initialize: function (settings) {
        geoapp.events.on('ga:navigateTo', this.navigateTo, this);
    },
    render: function () {
        this.$el.html(geoapp.templates.controls());
        return this;
    },
    /**
     * Changes the current body view to the view class specified by view.
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

var geo_map = null, drawTimer = null, drawQueued = false;

function showMap(data) {
    if (!geo_map) {
        geo_map = geo.map({
            node: '#ga-main-map',
            center: {
                x: -73.978165,
                y: 40.757977
            },
            zoom: 9,
        });
        geo_map.createLayer('osm', {
            baseUrl: 'http://otile1.mqcdn.com/tiles/1.0.0/map/',
            //baseUrl: 'http://tile.openstreetmap.org/'
            zoomDelta: 3.5,
        });
        geo_layer = geo_map.createLayer('feature');
        geo_feature = geo_layer.createFeature('point', {selectionAPI:true})
    }
    geo_feature.data(data)
        .style({
//            fillColor: '#91bfff',
            fillColor: 'black',
            fillOpacity: 0.05,
//            fillOpacity: 0.65,
//            strokeColor: 'black',
//            strokeWidth: 1,
            strokeWidth: 0,
            strokeOpacity: 0,
            radius: 5,
        })
        .position(function (d) {
            return {
                x: d.pickup_longitude,
                y: d.pickup_latitude
            };
        });
    //DWM::
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


$(document).ready(function () {
    girder.apiRoot = 'api/v1';
    app = new geoapp.views.ControlsView({el: '#app-container', parentView: null});

});
