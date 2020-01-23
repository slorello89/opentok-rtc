/* global RoomView, Cronograph, FirebaseModel, RecordingsController, Modal,
BubbleFactory, Clipboard, LayoutManager */

!(function (exports) {
  'use strict';

  // HTML elements for the view
  var dock;
  var handler;
  var callControlsElem;
  var feedbackButton;
  var roomNameElem;
  var togglePublisherVideoElem;
  var togglePublisherAudioElem;
  var startArchivingElem;
  var stopArchivingElem;
  var annotateBtnElem;
  var manageRecordingsElem;
  var messageButtonElem;
  var participantsStrElem;
  var recordingsNumberElem;
  var videoSwitch;
  var audioSwitch;
  var topBannerElem;
  var screenElem;
  var unreadCountElem;
  var enableArchiveManager;
  var enableSip;
  var hideCallControlsTimer;
  var hideFeedbackButtonTimer;
  var overCallControls = false;
  var overFeedbackButton = false;
  var pinCallControl = true;

  var _unreadMsg = 0;
  var _chatHasBeenShown = false;

  var MODAL_TXTS = {
    mute: {
      head: 'Mute all participants, including yourself',
      detail: 'Everyone will be notified and can click their <i data-icon="no_mic"></i> button' +
              ' to unmute themselves.',
      button: 'Mute all participants'
    },
    muteRemotely: {
      head: 'All participants microphones are being disabled in the call',
      detail: 'If you want to keep talking, ' +
              'you must manually enable your own microphone.',
      button: 'I understand'
    },
    unmutedRemotely: {
      head: 'Your microphone is now enabled in the call',
      detail: 'If you want to remain muted, ' +
              'you must manually disable your own microphone.',
      button: 'I understand'
    },
    join: {
      head: 'All participants are muted',
      detail: 'You can unmute everyone by toggling the Mute all participants option. Or you can ' +
              'unmute just yourself by clicking the microphone icon in the bottom menu.',
      button: 'I understand'
    },
    endCall: {
      head: 'Exit the Meeting',
      detail: 'You are going to exit the OpenTok Meeting Room. The call will continue with the ' +
              'remaining participants.',
      button: 'End meeting'
    },
    sessionDisconnected: {
      head: 'Session disconected',
      detail: 'The connection to the OpenTok platform has been lost. Check your network ' +
              'connectivity and press Reload to connect again.',
      button: 'Reload'
    },
    chromePublisherError: {
      head: 'Internal Chrome Error',
      detail: 'Failed to acquire microphone. This is a known Chrome bug. Please completely quit ' +
              'and restart your browser.',
      button: 'Reload'
    }
  };

  var NOT_SHARING = {
    detail: {
      isSharing: false
    }
  };

  function setUnreadMessages(count) {
    _unreadMsg = count;
    // document.getElementById('unreadMsg').style.display = count === 0 ? 'none' : 'block';
    unreadCountElem.textContent = count;
    // HTMLElems.flush(unreadCountElem.parentElement);
  }

  function setChatStatus(visible) {
    if (visible) {
      _chatHasBeenShown = true;
      setUnreadMessages(0);
      messageButtonElem.classList.add('activated');

      // hide call controls on small screens
      if (window.innerWidth <= 480) {
        hideCallControls();
      }
    } else {
      messageButtonElem.classList.remove('activated');
    }
    Utils.sendEvent('roomView:chatVisibility', visible);
    HTMLElems.flush('#toggleChat');
  }

  var chatViews = {
    unreadMessage: function () {
      setUnreadMessages(_unreadMsg + 1);
      if (!_chatHasBeenShown) {
        setChatStatus(true);
      }
    },
    hidden: function () {
      Utils.sendEvent('roomView:screenChange');
    },
    shown: function () {
      Utils.sendEvent('roomView:screenChange');
    }
  };

  var chatEvents = {
    hidden: function () {
      document.body.data('chatStatus', 'hidden');
      messageButtonElem.classList.remove('activated');
      setUnreadMessages(0);
      HTMLElems.flush('#toggleChat');
    }
  };

  var hangoutEvents = {
    screenOnStage: function (event) {
      var status = event.detail.status;
      if (status === 'on') {
        dock.data('previouslyCollapsed', dock.classList.contains('collapsed'));
        dock.classList.add('collapsed');
      } else if (dock.data('previouslyCollapsed') !== null) {
        dock.data('previouslyCollapsed') === 'true' ? dock.classList.add('collapsed') :
          dock.classList.remove('collapsed');
        dock.data('previouslyCollapsed', null);
      }
    },
    rearranged: function () {
      Utils.sendEvent('roomView:screenChange');
    }
  };

  var screenShareCtrEvents = {
    changeScreenShareStatus: toggleScreenSharing,
    destroyed: toggleScreenSharing.bind(undefined, NOT_SHARING),
    annotationStarted: function () {
      Utils.setDisabled(annotateBtnElem, false);
    },
    annotationEnded: function () {
      document.body.data('annotationVisible', 'false');
      Utils.setDisabled(annotateBtnElem, true);
    }
  };

  var roomControllerEvents = {
    userChangeStatus: function (evt) {
      // If user changed the status we need to reset the switch
      if (evt.detail.name === 'video') {
        setSwitchStatus(false, false, videoSwitch, 'roomView:videoSwitch');
      } else if (evt.detail.name === 'audio') {
        setSwitchStatus(false, false, audioSwitch, 'roomView:muteAllSwitch');
      }
    },
    roomMuted: function (evt) {
      var isJoining = evt.detail.isJoining;
      setAudioSwitchRemotely(true);
      Modal.showConfirm(isJoining ? MODAL_TXTS.join : MODAL_TXTS.muteRemotely);
    },
    sessionDisconnected: function () {
      RoomView.participantsNumber = 0;
      LayoutManager.removeAll();
    },
    controllersReady: function () {
      var selectorStr = '#top-banner [disabled], .call-controls [disabled]'
        + ':not(#toggle-publisher-video):not(#toggle-publisher-audio)'
        + ':not(#annotate)';
      var elements = document.querySelectorAll(selectorStr);
      Array.prototype.forEach.call(elements, function (element) {
        Utils.setDisabled(element, false);
      });
    },
    annotationStarted: function () {
      Utils.setDisabled(annotateBtnElem, false);
    },
    annotationEnded: function () {
      document.body.data('annotationVisible', 'false');
      Utils.setDisabled(annotateBtnElem, true);
    },
    chromePublisherError: function () {
      Modal.showConfirm(MODAL_TXTS.chromePublisherError).then(function () {
        document.location.reload();
      });
    }
  };

  function setAudioSwitchRemotely(isMuted) {
    setSwitchStatus(isMuted, false, audioSwitch, 'roomView:muteAllSwitch');
    isMuted ?
      setPublisherAudioSwitchStatus('muted') :
      setPublisherAudioSwitchStatus('activated');
  }

  function showConfirmChangeMicStatus(isMuted) {
    return Modal.showConfirm(isMuted ? MODAL_TXTS.muteRemotely : MODAL_TXTS.unmutedRemotely);
  }

  function initHTMLElements() {
    dock = document.getElementById('top-banner');
    handler = dock;
    callControlsElem = document.querySelector('.call-controls');
    feedbackButton = document.querySelector('.feedbackButton');
    roomNameElem = dock.querySelector('.room-name');
    participantsStrElem = document.getElementById('participantsStr');
    recordingsNumberElem = dock.querySelector('#recordings');
    videoSwitch = dock.querySelector('#videoSwitch');
    audioSwitch = dock.querySelector('#audioSwitch');
    unreadCountElem = document.getElementById('unreadCount');
    togglePublisherAudioElem = document.getElementById('toggle-publisher-audio');
    togglePublisherVideoElem = document.getElementById('toggle-publisher-video');
    startArchivingElem = document.getElementById('startArchiving');
    stopArchivingElem = document.getElementById('stopArchiving');
    annotateBtnElem = document.getElementById('annotate');
    manageRecordingsElem = document.getElementById('manageRecordings');
    messageButtonElem = document.getElementById('message-btn');
    topBannerElem = document.getElementById('top-banner');
    screenElem = document.getElementById('screen');
    document.getElementById("videoSwitch").tabIndex="1";
    document.getElementById("audioSwitch").tabIndex="2";
    document.getElementById("toggleFacingMode").tabIndex="3";
    document.getElementById("pickMic").tabIndex="4";
    document.getElementById("startArchiving").tabIndex="5";
    document.getElementById("chooseLayout").tabIndex="6";
    document.getElementById("pin").tabIndex="7";
    document.getElementById("endCall").tabIndex="8";
    document.getElementById("toggle-publisher-video").tabIndex="9";
    document.getElementById("toggle-publisher-audio").tabIndex="10";
    document.getElementById("addToCall").tabIndex="11";
    // document.getElementById("screen-share").tabIndex="12";
    document.getElementById("message-btn").tabIndex="13";   


    // The title takes two lines maximum when the dock is expanded. When the title takes
    // one line with expanded mode, it ends taking two lines while is collapsing because the witdh
    // is reduced, so we have to fix the height to avoid this ugly effect during transition.
    // var title = dock.querySelector('.info h1');
    // title.style.height = title.clientHeight + 'px';
  }

  function createStreamView(streamId, type, controlBtns, name) {
    return LayoutManager.append(streamId, type, controlBtns, name);
  }

  function deleteStreamView(id) {
    LayoutManager.remove(id);
  }

  function showRoom() {
    initHTMLElements();
    topBannerElem.style.visibility = 'visible';
    screenElem.style.visibility = 'visible';
    screenElem.addEventListener('mousemove', showControls);
    callControlsElem.addEventListener('mouseover', function () {
      clearTimeout(hideCallControlsTimer);
      overCallControls = true;
    });
    callControlsElem.addEventListener('mouseout', function () {
      overCallControls = false;
      hideCallControls();
    });
    feedbackButton && feedbackButton.addEventListener('mouseover', function () {
      clearTimeout(hideFeedbackButtonTimer);
      overFeedbackButton = true;
    });
    feedbackButton && feedbackButton.addEventListener('mouseout', function () {
      overFeedbackButton = false;
      hideFeedbackButton();
    });
  }

  function showControls() {
    showCallControls();
    showFeedbackButton();
  }

  function showCallControls() {
    callControlsElem.classList.add('visible');
    if (!overCallControls && !hideCallControlsTimer) {
      hideCallControlsTimer = setTimeout(hideCallControls, 3000);
    }
  }

  function hideCallControls() {
    if (pinCallControl)
    {
      return;
    }      
    hideCallControlsTimer = null;
    callControlsElem.classList.remove('visible');
  }

  function showFeedbackButton() {
    if (!feedbackButton) {
      return;
    }
    feedbackButton.classList.add('visible');
    if (!overFeedbackButton && !hideFeedbackButtonTimer) {
      hideFeedbackButtonTimer = setTimeout(hideFeedbackButton, 3000);
    }
  }

  function hideFeedbackButton() {
    hideFeedbackButtonTimer = null;
    feedbackButton.classList.remove('visible');
  }


  function showPublisherButtons(publisherOptions) {
    Utils.setDisabled(togglePublisherVideoElem, false);
    Utils.setDisabled(togglePublisherAudioElem, false);
    if (publisherOptions.publishVideo) {
      togglePublisherVideoElem.classList.add('activated');
      togglePublisherVideoElem.querySelector('i').data('icon', 'video_icon');
    }
    if (publisherOptions.publishAudio) {
      setPublisherAudioSwitchStatus('activated');
    }
  }

  function setSwitchStatus(status, bubbleUp, domElem, evtName) {
    var oldStatus = domElem.classList.contains('activated');
    var newStatus;
    if (status === undefined) {
      newStatus = domElem.classList.toggle('activated');
    } else {
      newStatus = status;
      if (status) {
        domElem.classList.add('activated');
      } else {
        domElem.classList.remove('activated');
      }
    }
    bubbleUp && newStatus !== oldStatus && Utils.sendEvent(evtName, { status: newStatus });
  }

  function setPublisherAudioSwitchStatus(status) {
    if (status === 'activated') {
      togglePublisherAudioElem.classList.add('activated');
      togglePublisherAudioElem.querySelector('i').data('icon', 'mic');
    } else {
      togglePublisherAudioElem.classList.remove('activated');
      togglePublisherAudioElem.querySelector('i').data('icon', 'mic-muted');
    }
  }

  var cronograph = null;

  function getCronograph() {
    if (cronograph) {
      return Promise.resolve(cronograph);
    }
    return LazyLoader.dependencyLoad([
      '/js/components/cronograph.js'
    ]).then(function () {
      cronograph = Cronograph;
      return cronograph;
    });
  }

  function onStartArchiving(data) {
    getCronograph().then(function (cronograph) { // eslint-disable-line consistent-return
      var start = function (archive) {
        var duration = 0;
        archive && (duration = Math.round((Date.now() - archive.createdAt) / 1000));
        cronograph.start(duration);
        startArchivingElem.style.display = 'none';
        stopArchivingElem.style.display = 'block';
        manageRecordingsElem.classList.add('recording');
      };

      if (!enableArchiveManager) {
        cronograph.init();
        return start(null);
      }

      var onModel = function () { // eslint-disable-line consistent-return
        var archives = FirebaseModel.archives;
        var archiveId = data.id;

        if (archives) {
          return start(archives[archiveId]);
        }

        FirebaseModel.addEventListener('value', function onValue(archives) {
          FirebaseModel.removeEventListener('value', onValue);
          start(archives[archiveId]);
        });
      };

      var model = RecordingsController.model;

      if (model) {
        cronograph.init();
        return onModel(model);
      }

      cronograph.init('Recording');
      exports.addEventListener('recordings-model-ready', function gotModel() {
        exports.removeEventListener('recordings-model-ready', gotModel);
        onModel(RecordingsController.model);
      });
    });
  }

  function onStopArchiving() {
    getCronograph().then(function (cronograph) {
      stopArchivingElem.style.display = 'none';
      startArchivingElem.style.display = 'inline-block';
      manageRecordingsElem.classList.remove('recording');
      cronograph.stop();
    });
  }

  var addHandlers = function () {
    handler.addEventListener('click', function () {
      dock.classList.toggle('collapsed');
      dock.data('previouslyCollapsed', null);
    });

    callControlsElem.addEventListener('click', function (e) {
      var elem = e.target;
      elem = HTMLElems.getAncestorByTagName(elem, 'button');
      if (elem === null) {
        return;
      }
      switch (elem.id) {
        case 'pin':
            pinCallControl = !pinCallControl;
            if (!pinCallControl){
              hideCallControls();
            }
            else{
              showCallControls();
            }
            break;
        case 'addToCall':
          Utils.sendEvent('roomView:addToCall');
          break;
        case 'toggle-publisher-video':
          var hasVideo;
          if (elem.classList.contains('activated')) {
            elem.classList.remove('activated');
            elem.querySelector('i').data('icon', 'no_video');
            hasVideo = false;
          } else {
            elem.classList.add('activated');
            elem.querySelector('i').data('icon', 'video_icon');
            hasVideo = true;
          }
          Utils.sendEvent('roomView:togglePublisherVideo', { hasVideo: hasVideo });
          break;
        case 'toggle-publisher-audio':
          var hasAudio;
          if (elem.classList.contains('activated')) {
            elem.classList.remove('activated');
            elem.querySelector('i').data('icon', 'mic-muted');
            hasAudio = false;
          } else {
            elem.classList.add('activated');
            elem.querySelector('i').data('icon', 'mic');
            hasAudio = true;
          }
          Utils.sendEvent('roomView:togglePublisherAudio', { hasAudio: hasAudio });
          break;
        case 'screen-share':
          Utils.sendEvent('roomView:shareScreen');
          break;
        case 'annotate':
          document.body.data('annotationVisible') === 'true' ?
            document.body.data('annotationVisible', 'false') : document.body.data('annotationVisible', 'true');
          Utils.sendEvent('roomView:screenChange');
          break;
        case 'message-btn':
          setChatStatus(!messageButtonElem.classList.contains('activated'));
          break;
        case 'endCall':
          Modal.showConfirm(MODAL_TXTS.endCall).then(function (endCall) {
            if (endCall) {
              RoomView.participantsNumber = 0;
              Utils.sendEvent('roomView:endCall');
            }
          });
          break;
      }
    });

    var menu = document.getElementById('top-banner');

    menu.addEventListener('click', interact);
    menu.addEventListener('keyup',function(e){
      var code = (e.keyCode ? e.keyCode : e.which);
    if (code==13) {
        interact(e);
    }
    })

    function interact(e){
      var elem = e.target;
      elem.blur();
      // pointer-events is not working on IE so we can receive as target a child
      elem = HTMLElems.getAncestorByTagName(elem, 'a');
      if (!elem) {
        return;
      }
      switch (elem.id) {
        case 'toggleFacingMode':
          Utils.sendEvent('roomView:toggleFacingMode');
          break;
        case 'pickMic':
          var select = document.getElementById('select-devices');
          select.style.display = 'inline-block';
          Modal.showConfirm({
            head: 'Set mic input',
            detail: 'Please identify the audio source in the following list:',
            button: 'Change'
          }).then(function (start) {
            if (start) {
              Utils.sendEvent('roomView:setAudioSource', select.value);
            }
            select.style.display = 'none';
          });
          break;
        case 'viewRecordings':
          BubbleFactory.get('viewRecordings').toggle();
          break;
        case 'chooseLayout':
          BubbleFactory.get('chooseLayout').toggle();
          break;
        case 'startArchiving':
        case 'stopArchiving':
          Utils.sendEvent('roomView:' + elem.id);
          break;
        case 'startChat':
        case 'stopChat':
          setChatStatus(elem.id === 'startChat');
          break;
        case 'endCall':
          Modal.showConfirm(MODAL_TXTS.endCall).then(function (endCall) {
            if (endCall) {
              RoomView.participantsNumber = 0;
              Utils.sendEvent('roomView:endCall');
            }
          });
          break;
        case 'startSharingDesktop':
        case 'stopSharingDesktop':
          Utils.sendEvent('roomView:shareScreen');
          break;
        case 'videoSwitch':
          if (!videoSwitch.classList.contains('activated')) {
            setSwitchStatus(true, true, videoSwitch, 'roomView:videoSwitch');
          } else {
            setSwitchStatus(false, true, videoSwitch, 'roomView:videoSwitch');
          }
          break;
        case 'audioSwitch':
          if (!audioSwitch.classList.contains('activated')) {
            Modal.showConfirm(MODAL_TXTS.mute).then(function (shouldDisable) {
              if (shouldDisable) {
                setSwitchStatus(true, true, audioSwitch, 'roomView:muteAllSwitch');
                togglePublisherAudioElem.classList.remove('activated');
              }
            });
          } else {
            setSwitchStatus(false, true, audioSwitch, 'roomView:muteAllSwitch');
            togglePublisherAudioElem.classList.add('activated');
          }
      }
    }

    if (enableSip) {
      var dialOutBtn = document.getElementById('dialOutBtn');
      // Send event to get phonenumber from phoneNumberView
      dialOutBtn.addEventListener('click', function (event) {
        event.preventDefault();
        Utils.sendEvent('roomView:verifyDialOut');
      });

      // Listen for PhoneNumberView event
      Utils.addEventsHandlers('phoneNumberView:', {
        dialOut: function (evt) {
          var phonenumber = evt.detail;
          Utils.sendEvent('roomView:dialOut', phonenumber);
        }
      });
    }

    exports.addEventListener('archiving', function (e) {
      var detail = e.detail;

      switch (detail.status) {
        case 'started':
          onStartArchiving(detail);

          break;
        case 'stopped':
          onStopArchiving();
          break;
      }

      document.body.data('archiveStatus', e.detail.status);
      HTMLElems.flush(['#toggleArchiving', '[data-stream-type=publisher] [data-icon="record"]']);
    });

    Utils.addEventsHandlers('screenShareController:', screenShareCtrEvents, exports);
    Utils.addEventsHandlers('roomController:', roomControllerEvents, exports);
    Utils.addEventsHandlers('chat:', chatEvents);
    Utils.addEventsHandlers('chatView:', chatViews);
    Utils.addEventsHandlers('hangout:', hangoutEvents);
  };

  function toggleScreenSharing(evt) {
    var isSharing = evt.detail.isSharing;
    document.body.data('desktopStatus', isSharing ? 'sharing' : 'notSharing');
    HTMLElems.flush('#toggleSharing');
  }

  var getURLtoShare = function () {
    return window.location.origin + window.location.pathname;
  };

  var addClipboardFeature = function () {
    var input = document.getElementById('current-url');
    input.addEventListener('click', function () {
      input.select();
    });
    var urlToShare = getURLtoShare();
    input.value = urlToShare;
    var clipboard = new Clipboard(document.querySelector('#addToCall'), { // eslint-disable-line no-unused-vars
      text: function () {
        return urlToShare;
      }
    });
  };

  var init = function (enableHangoutScroll, aEnableArchiveManager, aEnableSip) {
    enableArchiveManager = aEnableArchiveManager;
    initHTMLElements();
    dock.style.visibility = 'visible';
    enableSip = aEnableSip;
    addHandlers();
    addClipboardFeature();
    LayoutManager.init('.streams', enableHangoutScroll);
  };

  exports.RoomView = {
    init: init,

    set roomName(value) {
      HTMLElems.addText(roomNameElem, value);
    },

    set participantsNumber(value) {
      HTMLElems.replaceText(participantsStrElem, value);
    },

    set recordingsNumber(value) {
      if (!manageRecordingsElem) {
        return;
      }
      if (value === 0) {
        manageRecordingsElem.style.display = 'none';
        document.getElementById('toggleArchiving').classList.remove('manage-recordings');
      } else {
        manageRecordingsElem.style.display = 'block';
        recordingsNumberElem && (recordingsNumberElem.textContent = value);
        document.getElementById('toggleArchiving').classList.add('manage-recordings');
      }
    },

    showRoom: showRoom,
    showPublisherButtons: showPublisherButtons,
    createStreamView: createStreamView,
    deleteStreamView: deleteStreamView,
    setAudioSwitchRemotely: setAudioSwitchRemotely,
    showConfirmChangeMicStatus: showConfirmChangeMicStatus
  };
}(this));
