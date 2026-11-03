const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
const tabPanels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')));
const menuToggle = document.querySelector('.menu-toggle');
const mainNav = document.querySelector('#main-nav');

function selectTab(selectedIndex, moveFocus = false) {
  tabs.forEach((tab, index) => {
    const isSelected = index === selectedIndex;
    tab.setAttribute('aria-selected', String(isSelected));
    tab.tabIndex = isSelected ? 0 : -1;
    tabPanels[index].hidden = !isSelected;
  });

  if (moveFocus) tabs[selectedIndex].focus();
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(index));
  tab.addEventListener('keydown', (event) => {
    let nextIndex;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    selectTab(nextIndex, true);
  });
});

menuToggle?.addEventListener('click', () => {
  const isExpanded = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!isExpanded));
  menuToggle.setAttribute('aria-label', isExpanded ? 'Abrir menú' : 'Cerrar menú');
  mainNav.classList.toggle('open', !isExpanded);
});

mainNav?.addEventListener('click', (event) => {
  if (!event.target.closest('a') || !menuToggle) return;
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Abrir menú');
  mainNav.classList.remove('open');
});
