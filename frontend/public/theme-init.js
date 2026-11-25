(function () {
  try {
    var stored = localStorage.getItem("bantai-theme");
    var theme = stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";
    var isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
  } catch (e) {
    document.documentElement.classList.add("dark");
  }
})();
