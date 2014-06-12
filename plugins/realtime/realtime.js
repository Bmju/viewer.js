/**
 * @fileOverview The realtime plugin for the View API
 * @author lakenen
 */

(function () {

/**
 * Wrapper around the EventSource object for simple event subscription
 * @param {string} url The realtime URL to connect to
 * @constructor
 */
function Realtime(url) {
    if (!window.EventSource) {
        throw new Error('Realtime plugin requires EventSource support');
    }
    this.eventSource = new window.EventSource(url);
}

Realtime.prototype = {
    constructor: Realtime,

    /**
     * Subscribe to realtime events for the given event name
     * @param   {string}   name     The name of the event
     * @param   {Function} handler  The event handler function
     * @returns {void}
     */
    on: function (name, handler) {
        this.eventSource.addEventListener(name, handler, false);
    },

    /**
     * Unsubscribe from a realtime event of the given name and handler
     * @param   {string}   name     The name of the event
     * @param   {Function} handler  The event handler function
     * @returns {void}
     */
    off: function (name, handler) {
        this.eventSource.removeEventListener(name, handler);
    },

    /**
     * Cleans up the eventSource object
     * @returns {void}
     */
    destroy: function () {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
    }
};

// expose this on the Crocodoc namespace for testing
Crocodoc.Realtime = Realtime;

Crocodoc.addPlugin('realtime', function (scope) {
    'use strict';

    var util = scope.getUtility('common'),
        viewerConfig = scope.getConfig(),
        viewerAPI = viewerConfig.api,
        realtime,
        ready = false,
        messageQueue = [];

    /**
     * Broadcast a message or queue it until the viewer is ready
     * @param   {string} name The name of the message
     * @param   {*} data The message data
     * @returns {void}
     * @private
     */
    function broadcastMessageWhenReady(name, data) {
        if (ready) {
            scope.broadcast(name, data);
        } else {
            messageQueue.push({ name: name, data: data });
        }
    }

    /**
     * Broadcasts any (pageavailable) messages that were queued up
     * before the viewer was ready
     * @returns {void}
     * @private
     */
    function broadcastQueuedMessages() {
        var message;
        while (messageQueue.length) {
            message = messageQueue.shift();
            scope.broadcast(message.name, message.data);
        }
    }

    /**
     * Handle ready message from the viewer
     * @returns {void}
     * @private
     */
    function handleReadyMessage() {
        ready = true;
        broadcastQueuedMessages();
    }

    /**
     * Notify the viewer that new pages are available for loading
     * @param   {Array} pages Array of integer page numbers that are available
     * @returns {void}
     * @private
     */
    function updateAvailablePages(pages) {
        var i, page;
        for (i = 0; i < pages.length; ++i) {
            page = pages[i];
            broadcastMessageWhenReady('pageavailable', { page: page });
        }
    }

    /**
     * Handle pageavailable eventSource events
     * @param   {Event} event The event object
     * @returns {void}
     * @private
     */
    function handlePageAvailableEvent(event) {
        updateAvailablePages(util.parseJSON(event.data).pages);
    }

    /**
     * Handle error and failed eventSource events
     * @param   {Event} event The event object
     * @returns {void}
     * @private
     */
    function handleErrorEvent(event) {
        var data;
        try {
            data = util.parseJSON(event.data);
        } catch (e) {
            data = {
                error: event.data
            };
        }
        viewerAPI.fire('realtimeerror', { error: data.error || 'unspecified error' });
        realtime.destroy();
    }

    /**
     * Handle finished eventSource events
     * @param   {Event} event The event object
     * @returns {void}
     * @private
     */
    function handleFinishedEvent() {
        broadcastMessageWhenReady('pageavailable', { upto: viewerConfig.numPages });
        viewerAPI.fire('realtimecomplete');
        realtime.destroy();
    }

    /**
     * Registers event handlers for page streaming specific realtime events
     * @returns {void}
     * @private
     */
    function registerBoxViewPageEventHandlers() {
        // event names depend on whether we support svg or not
        if (scope.getUtility('support').svg) {
            realtime.on('pageavailable.svg', handlePageAvailableEvent);
            realtime.on('finished.svg', handleFinishedEvent);
            realtime.on('failed.svg', handleErrorEvent);
        } else {
            realtime.on('pageavailable.png', handlePageAvailableEvent);
            realtime.on('finished.png', handleFinishedEvent);
            realtime.on('failed.png', handleErrorEvent);
        }
    }

    return {
        messages: ['ready'],

        /**
         * Handle messages from the viewer scope
         * @returns {void}
         */
        onmessage: function () {
            // @NOTE: we're only listening for one message type, so we don't
            // need to check the name
            handleReadyMessage();
        },

        /**
         * Initialize the realtime plugin
         * @param   {Object} config     The config object
         * @param   {string} config.url The URL to connect to for realtime events
         * @returns {void}
         */
        init: function (config) {
            var url = config.url;
            if (url) {
                realtime = new Crocodoc.Realtime(url);

                realtime.on('error', handleErrorEvent);

                // force the viewer to think conversion is not complete
                // @TODO: ideally this wouldn't have to make an extra trip to
                // the server just to find out the doc is already done
                // converting, so we should have an indicator of the doc status
                // in the session endpoint response
                viewerConfig.conversionIsComplete = false;
                registerBoxViewPageEventHandlers();
            }
        },

        /**
         * Destroy and cleanup the realtime plugin
         * @returns {void}
         */
        destroy: function () {
            if (realtime) {
                realtime.destroy();
                realtime = null;
            }
            util = viewerAPI = viewerConfig = messageQueue = null;
        }
    };
});

})();
