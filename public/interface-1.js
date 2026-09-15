
(function(){
  window.setTheme = window.setTheme || function(theme){
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("myf-theme", theme); } catch(e) {}
    document.querySelectorAll("[data-theme-choice]").forEach(function(btn){
      btn.classList.toggle("active", btn.getAttribute("data-theme-choice") === theme);
    });
  };
  window.switchLTab = window.switchLTab || function(tab){
    document.querySelectorAll(".login-tab").forEach(function(t,i){
      t.classList.toggle("active", ["user","admin"][i] === tab);
    });
    ["ls-user","ls-admin"].forEach(function(id){
      var el=document.getElementById(id);
      if(el) el.classList.remove("active");
    });
    var target=document.getElementById("ls-"+tab);
    if(target) target.classList.add("active");
  };
  window.tpw = window.tpw || function(id, btn){
    var el=document.getElementById(id);
    if(!el) return;
    var h = el.type === "password";
    el.type = h ? "text" : "password";
    if(btn) btn.textContent = h ? "Masquer" : "Voir";
  };
  document.addEventListener("DOMContentLoaded", function(){
    try { setTheme(localStorage.getItem("myf-theme") || "dark"); } catch(e) { setTheme("dark"); }
    setTimeout(function(){
      if(!window.__MYF_APP_READY__){
        console.warn("MYF: app_v19.js non chargé. Vérifie que le fichier est dans le même dossier que index.html.");
      }
    }, 1500);
  });
})();
