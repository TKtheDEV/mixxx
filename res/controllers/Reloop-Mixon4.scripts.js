// Reloop-Mixon4.scripts.js

/************************  GPL v2 licence  *****************************
 * Reloop Mixon 4 controller script
 * Author:TKtheDEV <legendzmail@proton.me>
 *
 **********************************************************************
 *
 * Revision history
 * ----------------
 * 2025-10-17 - v0.1 - Jogs, Pitch Fader and Loops work
 ***********************************************************************
 *                           GPL v2 licence
 *                           --------------
 * Reloop Mixon 4 controller script 0.1 for Mixxx 2.5.2+
 * Copyright (C) 2025 TKtheDEV
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; either version 2
 * of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 ***********************************************************************/

var Mixon4 = typeof Mixon4 !== "undefined" ? Mixon4 : {};

// ===================== CORE CONFIG =====================
Mixon4.cfg = {
  // ---- Pitch fader ----
  pitchInvert: true,
  pitchDeadzone: 0,

  // ---- Jogs ----
  scratchEnabled: {1:false,2:false,3:false,4:false},
  jogNudgeMultiplier: 42.0,
  alpha: 1/8,
  beta: (1/8)/32,
  rpm: 33 + 1/3,
  samplesPerRev: 290,
  invertDirection: false,

  // ---- Loop LEDs: single note per deck ----
  loopLedNote: 0x09,
  loopLedStatus: {1:0x94,2:0x95,3:0x96,4:0x97},
  loopLedMaxValue: 0x0C,

  loopLedMasks: [
    0x07, // 1/32
    0x08, // 1/16
    0x09, // 1/8
    0x0A, // 1/4
    0x0B, // 1/2
    0x01, // 1
    0x02, // 2
    0x03, // 4
    0x04, // 8
    0x05, // 16
    0x06  // 32
  ],

  // ---- Loop button LED ----
  loopButtonNote: 0x08,
  loopButtonStatus: {1:0x94,2:0x95,3:0x96,4:0x97},
  loopButtonOn: 0x7F,
  loopButtonOff: 0x00,

  // ---- Tempo-center LED ----
  tempoCenterLED: {
    1: {status:0x94, data1:0x15},
    2: {status:0x95, data1:0x15},
    3: {status:0x96, data1:0x15},
    4: {status:0x97, data1:0x15},
  },
  tempoCenterEpsilon: 0.0005 // ~0.05%
};

// ===================== HELPERS =====================
Mixon4.channelToDeck = function(status){ var ch=status&0x0F; return (ch>=0x4&&ch<=0x7)?(ch-0x3):1; };
Mixon4.groupForStatus = function(status){ return "[Channel"+Mixon4.channelToDeck(status)+"]"; };
Mixon4.groupForDeck   = function(deck){ return "[Channel"+deck+"]"; };
Mixon4.deckFromGroup  = function(group){ var m=/\[Channel(\d+)\]/.exec(group); return m?parseInt(m[1],10):1; };

// ===================== INIT / SHUTDOWN =====================
Mixon4._rateConns = [];
Mixon4._loopConns = [];
Mixon4._loopEnabledConns = [];

// Loop size state
Mixon4._loopSizes = [1/32,1/16,1/8,1/4,1/2,1,2,4,8,16,32];
Mixon4._loopIdx   = {1:5,2:5,3:5,4:5};
Mixon4._lastLoopLedVal = {1:-1,2:-1,3:-1,4:-1};
Mixon4._lastLoopBtnVal = {1:-1,2:-1,3:-1,4:-1};

Mixon4.init = function() {
  [1,2,3,4].forEach(function(deck){
    var grp = Mixon4.groupForDeck(deck);
    engine.softTakeover(grp, "rate", true);

    var handler = function(v){ Mixon4._updateTempoLED(deck, v); };
    var conn = engine.connectControl(grp, "rate", handler);
    Mixon4._rateConns.push({deck:deck, conn:conn, handler:handler, group:grp});

    Mixon4._updateTempoLED(deck, engine.getValue(grp, "rate"));
  });

  [1,2,3,4].forEach(function(deck){
    var grp = Mixon4.groupForDeck(deck);

    var s = engine.getValue(grp, "beatloop_size") || 1;
    var idx = Mixon4._nearestLoopIndex(s);
    Mixon4._loopIdx[deck] = idx;
    Mixon4._renderLoopLed(deck, idx);

    var sizeHandler = function(value){
      var i = Mixon4._nearestLoopIndex(value || 1);
      if (i !== Mixon4._loopIdx[deck]) {
        Mixon4._loopIdx[deck] = i;
        Mixon4._renderLoopLed(deck, i);
      }
    };
    var sizeConn = engine.connectControl(grp, "beatloop_size", sizeHandler);
    Mixon4._loopConns.push({deck:deck, conn:sizeConn, handler:sizeHandler, group:grp});

    var loopEnabledHandler = function(val){
      Mixon4._setLoopButtonLED(deck, val > 0.5);
    };
    var loopConn = engine.connectControl(grp, "loop_enabled", loopEnabledHandler);
    Mixon4._loopEnabledConns.push({deck:deck, conn:loopConn, handler:loopEnabledHandler, group:grp});

    Mixon4._setLoopButtonLED(deck, engine.getValue(grp, "loop_enabled") > 0.5);
  });
};

Mixon4.shutdown = function(){
  (Mixon4._rateConns||[]).forEach(function(c){ try{ if(c.conn&&c.conn.disconnect) c.conn.disconnect(); }catch(_){} });
  (Mixon4._loopConns||[]).forEach(function(c){ try{ if(c.conn&&c.conn.disconnect) c.conn.disconnect(); }catch(_){} });
  (Mixon4._loopEnabledConns||[]).forEach(function(c){ try{ if(c.conn&&c.conn.disconnect) c.conn.disconnect(); }catch(_){} });
  Mixon4._rateConns=[]; Mixon4._loopConns=[]; Mixon4._loopEnabledConns=[];
};

// ===================== TEMPO-CENTER LED =====================
Mixon4._updateTempoLED = function(deck, rateValue){
  var led = (Mixon4.cfg.tempoCenterLED||{})[deck];
  if (!led) return;
  var on = Math.abs(rateValue) <= Mixon4.cfg.tempoCenterEpsilon;
  try { midi.sendShortMsg(led.status, led.data1, on?0x7F:0x00); } catch(_) {}
};

// ===================== PITCH FADER =====================
Mixon4.pitchBend14 = function(channel, lsb, msb, status){
  var grp = Mixon4.groupForStatus(status);
  var rate = script.midiPitch(lsb, msb, status);
  if (Mixon4.cfg.pitchInvert) rate = -rate;
  if (Math.abs(rate) < Mixon4.cfg.pitchDeadzone) rate = 0;
  engine.setValue(grp, "rate", rate);
};

// ===================== JOGS =====================
Mixon4.wheelTurn = function (channel, control, value, status, group) {
  if (value === 0x40) return;
  var deck  = Mixon4.deckFromGroup(group);
  var delta = (value - 64);
  if (Mixon4.cfg.invertDirection) delta = -delta;

  if (Mixon4.cfg.scratchEnabled[deck]) {
    engine.scratchTick(deck, delta);
  } else {
    engine.setValue(group, "jog", (delta/64.0) * Mixon4.cfg.jogNudgeMultiplier);
  }
};

// TOUCH: 9n 07 (0x7F on / 0x00 off)
Mixon4.wheelTouch = function (channel, control, value, status, group) {
  var deck = Mixon4.deckFromGroup(group);
  if (value > 0) {
    engine.scratchEnable(
      deck,
      Mixon4.cfg.samplesPerRev,
      Mixon4.cfg.rpm,
      Mixon4.cfg.alpha,
      Mixon4.cfg.beta
    );
    Mixon4.cfg.scratchEnabled[deck] = true;
  } else {
    engine.scratchDisable(deck);
    Mixon4.cfg.scratchEnabled[deck] = false;
  }
};

// ===================== LOOPS (encoder + toggle) =====================
Mixon4._nearestLoopIndex = function(size){
  var best=0, bestDiff=1e9;
  for (var i=0;i<Mixon4._loopSizes.length;i++){
    var d = Math.abs(Mixon4._loopSizes[i]-size);
    if (d < bestDiff){ best=i; bestDiff=d; }
  }
  return best;
};

// Helper: read a fresh baseline index from Mixxx before halving/doubling
Mixon4._currentLoopIdxFromMixxx = function(grp, fallbackIdx){
  var sz = engine.getValue(grp, "beatloop_size");
  if (sz && sz > 0) return Mixon4._nearestLoopIndex(sz);
  return (typeof fallbackIdx === "number") ? fallbackIdx : 5;
};

// apply selected index; **no wrap**; while active use halve/double from LIVE size
Mixon4._applyLoopSizeIndex = function(deck, idx){
  var idxClamped = Math.max(0, Math.min(10, idx));
  if (idxClamped !== idx) idx = idxClamped;
  var grp  = Mixon4.groupForDeck(deck);

  if (engine.getValue(grp, "loop_enabled")) {
    var curIdx = Mixon4._currentLoopIdxFromMixxx(grp, Mixon4._loopIdx[deck]);
    if (curIdx < idx) { for (var i=curIdx; i<idx; i++) engine.setValue(grp, "loop_double", 1); }
    else if (curIdx > idx) { for (var j=curIdx; j>idx; j--) engine.setValue(grp, "loop_halve", 1); }
  } else {
    var size = Mixon4._loopSizes[idx];
    engine.setValue(grp, "beatloop_size", size);
  }

  Mixon4._loopIdx[deck] = idx;
  Mixon4._renderLoopLed(deck, idx);
};

// Encoder: Bn 08 — sign-only, saturating at ends
Mixon4.loopSizeEncoder = function(_ch,_control,value,status){
  var deck = Mixon4.channelToDeck(status);
  if (value === 0x40) return;
  var step = (value > 0x40) ? +1 : -1;

  var cur = (typeof Mixon4._loopIdx[deck] === "number") ? Mixon4._loopIdx[deck] : 5;
  var next = cur + step;

  if (next < 0) next = 0;
  if (next > 10) next = 10;
  if (next === cur) return;

  Mixon4._applyLoopSizeIndex(deck, next);
};

// Button: 9n 08 — toggle loop at current size
Mixon4.loopToggle = function(_ch,_control,value,status){
  if (value===0) return;
  var grp = Mixon4.groupForStatus(status);
  if (engine.getValue(grp,"loop_enabled")) {
    engine.setValue(grp,"reloop_exit",1);
  } else {
    var s = engine.getValue(grp,"beatloop_size");
    if (s<=0) engine.setValue(grp,"beatloop_size",1);
    engine.setValue(grp,"beatloop_activate",1);
  }
};

// ===================== LOOP LED OUTPUT =====================
Mixon4._sendLoopLed = function(deck, value){
  var status = Mixon4.cfg.loopLedStatus[deck];
  var note   = Mixon4.cfg.loopLedNote;
  var val    = Math.max(0, Math.min(Mixon4.cfg.loopLedMaxValue, value|0));
  if (Mixon4._lastLoopLedVal[deck] === val) return;
  Mixon4._lastLoopLedVal[deck] = val;
  try { midi.sendShortMsg(status, note, val); } catch(_) {}
};
Mixon4._renderLoopLed = function(deck, idx){
  var masks = Mixon4.cfg.loopLedMasks;
  var mask  = masks[idx] || 0x00;
  Mixon4._sendLoopLed(deck, mask);
};

// ===================== LOOP BUTTON LED =====================
Mixon4._setLoopButtonLED = function(deck, isOn){
  var status = Mixon4.cfg.loopButtonStatus[deck];
  var note   = Mixon4.cfg.loopButtonNote;
  var val    = isOn ? Mixon4.cfg.loopButtonOn : Mixon4.cfg.loopButtonOff;
  // cache to avoid redundant MIDI
  if (Mixon4._lastLoopBtnVal[deck] === val) return;
  Mixon4._lastLoopBtnVal[deck] = val;
  try { midi.sendShortMsg(status, note, val); } catch(_) {}
};

// --------------------------------------------------------------
if (typeof module !== "undefined") { module.exports = Mixon4; }
