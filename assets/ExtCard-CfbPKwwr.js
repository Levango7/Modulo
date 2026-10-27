import{_ as e,ln as t}from"./tokens-xkAaZ5Kv.js";import{D as n,F as r,H as i,N as a,T as o,a as s,c,f as l,h as u,l as d,lt as f,o as p,p as m,r as h,t as g,x as _,y as v,z as y}from"./_plugin-vue_export-helper-B2hOTz7v.js";import{a as b,i as x,r as S,t as ee}from"./extcard-CGNq7NSy.js";import{i as te,t as ne}from"./htmlcard-tjjhPxnS.js";import{t as re}from"./plus-NrM-2hcu.js";import{t as ie}from"./trash-2-rXIGY4Jk.js";import{n as C,t as w}from"./notify-BybYBfKl.js";var T={key:0,class:`xcard`},E={class:`xhead`},D={class:`xcount`},O={key:0,class:`xlist`},k={class:`xname`},A={class:`xmeta`},j=[`onClick`],M={key:1,class:`xempty`},N={class:`ximport`},P={key:0,class:`xerr`},F={class:`xrowbtn`},I=[`disabled`],L={key:1,class:`xcard`},R={class:`xbody`},ae=[`title`,`srcdoc`],z={key:2,class:`xcard`},B=g(u({__name:`ExtCard`,props:{variant:{},chromeless:{type:Boolean},moduleId:{}},setup(u){let g=u,B=v(`cardData`),V=v(`reminders`,null),H=s(()=>!g.moduleId||!x(g.moduleId)),U=y(``),W=y(``),G=s(()=>B.state.extCards);function K(){let e=B.addExtCard(U.value);if(e){W.value=e;return}U.value=``,W.value=``}function q(){W.value&&=``}function J(e){B.removeExtCard(e)}let Y=s(()=>H.value?null:B.state.extCards.find(e=>S(e.id)===g.moduleId)??null),X=y(null),oe=y(0);function se(e){return`<!doctype html><html><head><meta charset="utf-8">
<title>${e.title.replace(/[<>"]/g,``)}</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; background: transparent; color: var(--text-1);
    font: 13px/1.5 system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif; }
  body { padding: 8px; }
</style></head>
<body>
<script>
  window.MODULO = { vars: {}, bridge: null };
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.__modulo === 'init') {
      window.MODULO.vars = d.vars || {};
      if (typeof window.onModuloInit === 'function') { try { window.onModuloInit(window.MODULO.vars) } catch (err) {} }
      return;
    }
    if (d.__modulo === 'bridge') {
      var resolve = __pending[d.rid];
      if (!resolve) return;
      delete __pending[d.rid];
      resolve({ ok: !!d.ok, value: d.value, error: d.error });
    }
  });
  var __seq = 0; var __pending = {};
  window.MODULO.bridge = {
    call: function (method, args) {
      return new Promise(function (resolve) {
        var rid = 'r' + (++__seq);
        __pending[rid] = resolve;
        parent.postMessage({ __modulo: 'ext', payload: { bridge: { rid: rid, method: method, args: args === undefined ? null : args } } }, '*');
      });
    },
    getState: function () { return window.MODULO.bridge.call('getState'); },
    setState: function (v) { return window.MODULO.bridge.call('setState', v === undefined ? null : v); },
    notify: function (text) { return window.MODULO.bridge.call('notify', { text: String(text) }); }
  };
  ;(function () {
    var SNIPPET = ${te(e.html)};
    var parsed = new DOMParser().parseFromString(SNIPPET, 'text/html');
    var nodes = Array.prototype.slice.call(parsed.body.childNodes);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.tagName === 'SCRIPT') {
        var s = document.createElement('script');
        s.textContent = node.textContent || '';
        document.body.appendChild(s);
      } else {
        document.body.appendChild(document.importNode(node, true));
      }
    }
  })();
<\/script>
</body></html>`}function Z(){let e=X.value?.contentWindow;e&&Y.value&&e.postMessage({__modulo:`init`,vars:{title:Y.value.title,dark:document.documentElement.dataset.theme===`dark`,width:X.value?.clientWidth??0,height:X.value?.clientHeight??0}},`*`)}function Q(e,t,n,r){X.value?.contentWindow?.postMessage(ee(e,t,n,r),`*`)}async function ce(t,n){V&&C(e,V.state.settings.systemNotifications)&&await w([{key:`extcard:${n}`,title:n,body:t}])}function $(e){let t=X.value?.contentWindow??null;if(!Y.value||!ne(e.data,e.source,t))return;let n=b(e.data.payload);if(!n)return;let r=Y.value.id;if(n.method===`getState`)Q(n.rid,!0,JSON.parse(JSON.stringify(B.state.extState[r]??null)));else if(n.method===`setState`){let e=B.setExtState(r,n.args);e===null?Q(n.rid,!0,n.args):Q(n.rid,!1,void 0,e)}else ce(n.args.text,Y.value.title),Q(n.rid,!0,null)}return _(()=>window.removeEventListener(`message`,$)),window.addEventListener(`message`,$),a(()=>document.documentElement.dataset.theme,()=>Z()),(e,a)=>H.value?(o(),d(`div`,T,[p(`header`,E,[a[1]||=p(`span`,{class:`xtitle`},`原生卡`,-1),p(`span`,D,f(G.value.length)+` / `+f(i(8)),1)]),G.value.length?(o(),d(`div`,O,[(o(!0),d(h,null,n(G.value,e=>(o(),d(`div`,{key:e.id,class:`xrow`},[p(`span`,k,f(e.title),1),p(`span`,A,f(e.group)+` · `+f(e.variants.length)+` 个形态`,1),p(`button`,{class:`xdel`,title:`卸载这张扩展卡（版面上的实例刷新后消失）`,onClick:t=>J(e.id)},[m(i(ie),{size:12})],8,j)]))),128)),a[2]||=p(`p`,{class:`xtip`},`装好的卡在「添加卡片」里，按分组归位；卸载后它的状态一并清除。`,-1)])):(o(),d(`p`,M,`还没有装任何卡包。把卡包 JSON 粘到下面，导入后它会成为一张普通卡片。`)),p(`div`,N,[r(p(`textarea`,{"onUpdate:modelValue":a[0]||=e=>U.value=e,class:`xtarea`,spellcheck:`false`,"aria-label":`卡包 JSON`,placeholder:`{"id":"hello","title":"问候","html":"<b>你好</b>","variants":[{"id":"std","name":"标准","minW":2,"minH":2,"idealW":3,"idealH":3}]}`,onInput:q},null,544),[[t,U.value]]),W.value?(o(),d(`p`,P,f(W.value),1)):c(``,!0),p(`div`,F,[p(`button`,{class:`xok`,disabled:!U.value.trim(),onClick:K},[m(i(re),{size:11}),a[3]||=l(` 导入卡包`,-1)],8,I),a[4]||=p(`span`,{class:`xtip`},`沙箱隔离：碰不到应用数据；桥只有读写自身状态与发通知`,-1)])])])):Y.value?(o(),d(`div`,L,[p(`div`,R,[(o(),d(`iframe`,{ref_key:`frameEl`,ref:X,class:`xframe`,sandbox:`allow-scripts`,title:Y.value.title,srcdoc:se(Y.value),key:`${Y.value.id}:${oe.value}`,onLoad:Z},null,40,ae))])])):(o(),d(`div`,z,[...a[5]||=[p(`p`,{class:`xempty`},`这张扩展卡已被卸载。删掉这个格子即可；刷新后版面会自动清掉它。`,-1)]]))}}),[[`__scopeId`,`data-v-0d9fb21b`]]);export{B as default};