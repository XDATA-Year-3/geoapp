geoapp.views.ControlsView = geoapp.View.extend({
    events: {
        'click #ga-controls-filter': function () {
            var params = {}
            $('#ga-settings [taxifield]').each(function () {
                var elem = $(this);
                var value = elem.val();
                if (value.length > 0) {
                    params[elem.attr('taxifield')] = elem.val();
                }
            });
            replaceMapData({params: params});
        }
    },

    initialize: function () {
        girder.cancelRestRequests('fetch');
        this.render();
    },
    
    render: function () {
        this.$el.html(geoapp.templates.controls());
        showMap([]);
        return this;
    }
});

/*
geoapp.router.route('', 'index', function () {
    geoapp.events.trigger('ga:navigateTo', geoapp.views.ControlsView);
});
*/
