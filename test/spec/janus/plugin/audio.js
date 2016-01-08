var assert = require('chai').assert;
var expect = require('chai').expect;
var sinon = require('sinon');
var Promise = require('bluebird');
require('../../../helpers/global-error-handler');
var Connection = require('../../../../lib/janus/connection');
var Session = require('../../../../lib/janus/session');
var PluginAudio = require('../../../../lib/janus/plugin/audio');

var Logger = require('../../../../lib/logger');
var Stream = require('../../../../lib/stream');
var Streams = require('../../../../lib/streams');
var CmApiClient = require('../../../../lib/cm-api-client');
var serviceLocator = require('../../../../lib/service-locator');

describe('Audio plugin', function() {
  var plugin, session, connection, cmApiClient, streams;

  this.timeout(2000);

  before(function() {
    serviceLocator.reset();
    serviceLocator.register('logger', new Logger());
    serviceLocator.register('streams', new Streams());
  });

  beforeEach(function() {
    connection = new Connection('connection-id');
    session = new Session(connection, 'session-id', 'session-data');
    plugin = new PluginAudio('id', 'type', session);
    cmApiClient = sinon.createStubInstance(CmApiClient);
    serviceLocator.register('cm-api-client', cmApiClient);
    streams = sinon.createStubInstance(Streams);
    serviceLocator.register('streams', streams);

    connection.session = session;
    session.plugins[plugin.id] = plugin;
  });

  after(function() {
    serviceLocator.reset();
  });

  it('when processes invalid message', function(done) {
    var invalidRequestPromises = [];
    var invalidRequestActions = ['list', 'exists', 'resetdecoder', 'listparticipants'];

    invalidRequestActions.forEach(function(action) {
      var invalidRequest = {
        janus: 'message',
        body: {request: action},
        transaction: 'transaction-id'
      };
      invalidRequestPromises.push(plugin.processMessage(invalidRequest));
    });

    var destroyRequest = {
      janus: 'destroy',
      transaction: 'transaction-id'
    };
    invalidRequestPromises.push(plugin.processMessage(destroyRequest));


    Promise.all(invalidRequestPromises.map(function(promise) {
      return promise.reflect();
    })).then(function() {
      invalidRequestPromises.forEach(function(testPromise) {
        assert.isTrue(testPromise.isRejected());
      });
      done();
    });

  });

  it('when processes "join" message.', function() {
    var onJoinStub = sinon.stub(plugin, 'onJoin', function() {
      return Promise.resolve();
    });
    var joinRequest = {
      janus: 'message',
      body: {request: 'join'},
      transaction: 'transaction-id'
    };
    plugin.processMessage(joinRequest);

    assert(onJoinStub.calledOnce);
    assert(onJoinStub.calledWith(joinRequest));
  });

  it('when processes "changeroom" message.', function() {
    var onChangeroomStub = sinon.stub(plugin, 'onChangeroom', function() {
      return Promise.resolve();
    });
    var changeroomRequest = {
      janus: 'message',
      body: {request: 'changeroom'},
      transaction: 'transaction-id'
    };
    plugin.processMessage(changeroomRequest);

    assert(onChangeroomStub.calledOnce);
    assert(onChangeroomStub.calledWith(changeroomRequest));
  });

  it('join room', function(done) {
    var joinRequest = {
      janus: 'message',
      body: {request: 'join', id: 'streamId'},
      handle_id: plugin.id,
      transaction: 'transaction-id'
    };
    var joinResponse = {
      janus: 'event',
      plugindata: {data: {audioroom: 'joined'}},
      sender: plugin.id,
      transaction: joinRequest.transaction
    };

    plugin.processMessage(joinRequest).then(function() {
      connection.transactions.execute(joinResponse.transaction, joinResponse).then(function() {
        assert.equal(plugin.stream.channelName, joinRequest.body.id);
        done();
      });
    });
  });

  it('join room fail', function(done) {
    var joinRequest = {
      janus: 'message',
      body: {request: 'join', id: 'streamId'},
      handle_id: plugin.id,
      transaction: 'transaction-id'
    };
    var joinResponse = {
      janus: 'event',
      plugindata: {data: {error: 'error'}},
      sender: plugin.id,
      transaction: joinRequest.transaction
    };

    plugin.processMessage(joinRequest).then(function() {
      connection.transactions.execute(joinResponse.transaction, joinResponse).then(function() {
        assert.isNull(plugin.stream);
        done();
      });
    });
  });

  it('change room', function(done) {
    cmApiClient.subscribe.restore();
    sinon.stub(cmApiClient, 'subscribe', function() {
      return Promise.resolve();
    });

    var changeroomRequest = {
      janus: 'message',
      body: {request: 'changeroom', id: 'streamId'},
      handle_id: plugin.id,
      transaction: 'transaction-id'
    };
    var changeroomResponse = {
      janus: 'event',
      plugindata: {data: {audioroom: 'roomchanged', result: {}}},
      sender: plugin.id,
      transaction: changeroomRequest.transaction
    };

    plugin.processMessage(changeroomRequest).then(function() {
      connection.transactions.execute(changeroomRequest.transaction, changeroomResponse).then(function() {
        assert.equal(plugin.stream.channelName, changeroomRequest.body.id);
        expect(cmApiClient.subscribe.calledOnce).to.be.equal(true);
        var args = cmApiClient.subscribe.firstCall.args;
        expect(args[0]).to.be.equal(changeroomRequest.body.id);
        expect(args[1]).to.be.equal(plugin.stream.id);
        expect(args[2]).to.be.closeTo(Date.now() / 1000, 5);
        expect(args[3]).to.be.equal('session-data');
        expect(streams.add.withArgs(plugin.stream).calledOnce).to.be.equal(true);
        done();
      });
    });

  });

  it('change room fail', function(done) {
    cmApiClient.subscribe.restore();
    sinon.stub(cmApiClient, 'subscribe', function() {
      return Promise.resolve();
    });
    streams.has.returns(true);

    var changeroomRequest = {
      janus: 'message',
      body: {request: 'changeroom', id: 'streamId'},
      handle_id: plugin.id,
      transaction: 'transaction-id'
    };
    var changeroomResponse = {
      janus: 'event',
      plugindata: {data: {error: 'error', error_code: 455}},
      sender: plugin.id,
      transaction: changeroomRequest.transaction
    };

    var previousStream = new Stream('previousId', 'previousChannel', plugin);
    plugin.stream = previousStream;
    plugin.processMessage(changeroomRequest).then(function() {
      connection.transactions.execute(changeroomRequest.transaction, changeroomResponse).then(function() {
        expect(cmApiClient.removeStream.calledWith(previousStream.channelName, previousStream.id)).to.be.equal(true);
        expect(streams.remove.calledWith(previousStream)).to.be.equal(true);
        assert.equal(plugin.stream.channelName, changeroomRequest.body.id);
        expect(cmApiClient.subscribe.called).to.be.equal(false);
        expect(streams.add.called).to.be.equal(false);
        done();
      });
    });
  });

});
