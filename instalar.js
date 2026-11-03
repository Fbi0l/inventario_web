/* Inventário instalável (1.6.0): registra o service worker e mostra o aviso "Instalar" no Painel geral. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const ler=k=>{try{return localStorage.getItem(k);}catch(_){return null;}};
  const gravar=(k,v)=>{try{localStorage.setItem(k,v);}catch(_){/* navegador sem armazenamento */}};
  const instalado=()=>(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||window.navigator.standalone===true;
  const iPhone=/iphone|ipad|ipod/i.test(navigator.userAgent)&&!/crios|fxios|edgios/i.test(navigator.userAgent);
  let pedido=null;
  if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost')){
    navigator.serviceWorker.register('sw.js').catch(e=>console.warn('Service worker não registrado:',e&&e.message));
  }
  function mostrar(texto,comBotao){
    if(!$('installCard')||instalado()||ler('inventarioInstalarDispensado'))return;
    if(texto)$('installText').textContent=texto;
    $('installBtn').classList.toggle('hidden',!comBotao);
    $('installCard').classList.remove('hidden');
  }
  const esconder=()=>{if($('installCard'))$('installCard').classList.add('hidden');};
  window.addEventListener('beforeinstallprompt',ev=>{ev.preventDefault();pedido=ev;mostrar(null,true);});
  window.addEventListener('appinstalled',()=>{pedido=null;esconder();});
  function iniciar(){
    if(!$('installCard'))return;
    if(iPhone)mostrar('No iPhone: toque em Compartilhar (□↑) e depois em "Adicionar à Tela de Início".',false);
    $('installBtn').addEventListener('click',async()=>{
      if(!pedido)return;
      pedido.prompt();
      const escolha=await pedido.userChoice;
      pedido=null;
      if(escolha&&escolha.outcome==='accepted')esconder();
    });
    $('installClose').addEventListener('click',()=>{gravar('inventarioInstalarDispensado','1');esconder();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',iniciar);else iniciar();
})();
