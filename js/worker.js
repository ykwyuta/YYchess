/*
 * うごきがみえるチェス — CPU の思考を別スレッドで動かす（画面が固まらないように）
 */
/* global importScripts, AI */
importScripts('rules.js', 'ai.js');
self.onmessage = e => {
  const { id, board, turn, castle, ep, level, history } = e.data;
  const move = AI.think(Int8Array.from(board), turn, castle, ep, level, history);
  self.postMessage({ id, move });
};
