import { createClient } from '@supabase/supabase-js';

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

const portalStatus = document.querySelector('#portal-status');
const portalLoginForm = document.querySelector('#portal-login-form');
const portalPasswordUpdateForm = document.querySelector('#portal-password-update-form');
const portalAccount = document.querySelector('#portal-account');
const portalInvoiceList = document.querySelector('#invoice-list');
const paymentSubmit = document.querySelector('#payment-submit');
const portalUnavailable = document.querySelector('#portal-unavailable');
const returnedFromCheckout = new URLSearchParams(window.location.search).has('id');
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function setPortalMessage(message, kind = 'info') {
  portalStatus.textContent = message;
  portalStatus.dataset.kind = kind;
  portalStatus.hidden = false;
}

function showPortalError(action, error, message) {
  console.error(`Error al ${action} en el centro de pagos`, error);
  setPortalMessage(message, 'error');
}

function initializePaymentPortal() {
  if (!portalStatus || !portalLoginForm || !portalPasswordUpdateForm || !portalAccount || !portalInvoiceList || !paymentSubmit || !portalUnavailable) return;

  if (returnedFromCheckout) {
    window.history.replaceState(null, document.title, window.location.pathname);
  }

  if (!supabaseUrl || !supabasePublishableKey) {
    console.warn('El centro de pagos requiere VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.');
    return;
  }

  portalUnavailable.hidden = true;
  const supabase = createClient(supabaseUrl, supabasePublishableKey);
  let recoveryMode = false;
  let openInvoices = [];
  let selectedInvoiceId = '';

  portalLoginForm.hidden = false;
  if (returnedFromCheckout) {
    setPortalMessage('Regresaste de Wompi. El estado se actualizará cuando se confirme el pago.');
  }

  function updatePaymentSummary(invoice) {
    const emptyState = document.querySelector('#payment-summary-empty');
    const details = document.querySelector('#payment-summary-details');
    const selectedInvoice = document.querySelector('#selected-invoice');
    const amount = document.querySelector('#payment-total');

    emptyState.hidden = Boolean(invoice);
    details.hidden = !invoice;
    paymentSubmit.disabled = !invoice;
    if (!invoice) return;

    const moneyFormat = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: invoice.currency,
      maximumFractionDigits: invoice.currency === 'COP' ? 0 : 2,
    });
    selectedInvoice.textContent = `Factura ${invoice.invoice_number} · ${invoice.description}`;
    amount.textContent = moneyFormat.format(invoice.amount_cents / 100);
  }

  function renderSession(session) {
    if (recoveryMode) return;

    const isSignedIn = Boolean(session);
    portalLoginForm.hidden = isSignedIn;
    portalPasswordUpdateForm.hidden = true;
    portalAccount.hidden = !isSignedIn;

    if (isSignedIn) {
      document.querySelector('#portal-user-email').textContent = session.user.email || '';
      if (!returnedFromCheckout) portalStatus.hidden = true;
    } else {
      if (returnedFromCheckout) {
        setPortalMessage('Regresaste de Wompi. El estado se actualizará cuando se confirme el pago.');
      } else {
        portalStatus.hidden = true;
      }
      portalInvoiceList.replaceChildren();
      openInvoices = [];
      selectedInvoiceId = '';
      updatePaymentSummary(null);
    }
  }

  async function loadInvoices() {
    openInvoices = [];
    selectedInvoiceId = '';
    updatePaymentSummary(null);
    portalInvoiceList.replaceChildren();
    const emptyState = document.createElement('p');
    emptyState.className = 'invoice-empty';
    emptyState.textContent = 'Consultando tus facturas…';
    portalInvoiceList.append(emptyState);

    let invoices;
    let error;
    try {
      ({ data: invoices, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, description, amount_cents, currency, status, due_date, created_at')
        .order('created_at', { ascending: false }));
    } catch (requestError) {
      showPortalError('consultar facturas', requestError, 'No pudimos consultar tus facturas. Intenta actualizar o vuelve a ingresar.');
      return;
    }

    if (error) {
      showPortalError('consultar facturas', error, 'No pudimos consultar tus facturas. Intenta actualizar o vuelve a ingresar.');
      return;
    }
    if (!Array.isArray(invoices)) {
      showPortalError('consultar facturas', new Error('The invoice response was invalid.'), 'No pudimos consultar tus facturas. Intenta actualizar o vuelve a ingresar.');
      return;
    }

    portalInvoiceList.replaceChildren();
    if (!invoices.length) {
      emptyState.textContent = 'No hay facturas asociadas a esta cuenta. Si esperabas encontrar una, comunícate con nuestro equipo.';
      portalInvoiceList.append(emptyState);
      openInvoices = [];
      selectedInvoiceId = '';
      updatePaymentSummary(null);
      return;
    }

    openInvoices = invoices.filter((invoice) => invoice.status === 'open');
    if (!openInvoices.some((invoice) => invoice.id === selectedInvoiceId)) {
      selectedInvoiceId = openInvoices[0]?.id || '';
    }

    invoices.forEach((invoice) => {
      const item = document.createElement('article');
      item.className = 'invoice-item';
      const isOpen = invoice.status === 'open';

      const choice = document.createElement('label');
      choice.className = 'invoice-choice';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'selected-invoice';
      radio.value = invoice.id;
      radio.checked = isOpen && invoice.id === selectedInvoiceId;
      radio.disabled = !isOpen;
      radio.addEventListener('change', () => {
        selectedInvoiceId = invoice.id;
        portalInvoiceList.querySelectorAll('.invoice-item').forEach((invoiceItem) => {
          invoiceItem.dataset.selected = String(invoiceItem === item);
        });
        updatePaymentSummary(invoice);
      });
      const details = document.createElement('div');
      details.className = 'invoice-details';
      const number = document.createElement('strong');
      number.textContent = `Factura ${invoice.invoice_number}`;
      const description = document.createElement('span');
      description.textContent = invoice.description;
      details.append(number, description);
      if (invoice.due_date) {
        const dueDate = document.createElement('span');
        dueDate.textContent = `Vence: ${new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(`${invoice.due_date}T12:00:00`))}`;
        details.append(dueDate);
      }

      const info = document.createElement('div');
      info.className = 'invoice-info';
      const amount = document.createElement('strong');
      amount.className = 'invoice-amount';
      const moneyFormat = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: invoice.currency,
        maximumFractionDigits: invoice.currency === 'COP' ? 0 : 2,
      });
      amount.textContent = moneyFormat.format(invoice.amount_cents / 100);
      const state = document.createElement('span');
      state.className = 'invoice-state';
      const isPaid = invoice.status === 'paid';
      state.textContent = isPaid ? 'Pagada' : invoice.status === 'void' ? 'Anulada' : 'Pendiente';
      if (isPaid) state.dataset.state = 'paid';
      if (invoice.status === 'void') state.dataset.state = 'void';
      info.append(amount, state);

      choice.append(radio, details, info);
      item.dataset.selected = String(radio.checked);
      item.append(choice);
      portalInvoiceList.append(item);
    });

    updatePaymentSummary(openInvoices.find((invoice) => invoice.id === selectedInvoiceId));
  }

  paymentSubmit.addEventListener('click', async () => {
    const invoice = openInvoices.find((item) => item.id === selectedInvoiceId);
    if (!invoice) return;

    paymentSubmit.disabled = true;
    paymentSubmit.textContent = 'Preparando pago…';
    setPortalMessage('Preparando el pago seguro…');

    try {
      const { data, error: paymentError } = await supabase.functions.invoke('create-wompi-checkout', {
        body: { invoice_id: invoice.id },
      });
      if (paymentError) throw paymentError;
      if (typeof data?.checkout_url !== 'string') throw new Error('La función de pago no devolvió un enlace de checkout.');
      const checkout = new URL(data.checkout_url);
      if (checkout.origin !== 'https://checkout.wompi.co' || checkout.pathname !== '/p/') {
        throw new Error('La función de pago devolvió un destino no permitido.');
      }
      window.location.assign(checkout.toString());
    } catch (error) {
      showPortalError('preparar el pago', error, 'No pudimos preparar el pago. Actualiza tus facturas o inténtalo más tarde.');
      paymentSubmit.disabled = false;
      paymentSubmit.textContent = 'Pagar ahora';
    }
  });

  portalLoginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = document.querySelector('#portal-login-submit');
    const formData = new FormData(portalLoginForm);
    const email = formData.get('email');
    const password = formData.get('password');
    if (typeof email !== 'string' || typeof password !== 'string') {
      setPortalMessage('Escribe un correo y una contraseña válidos.', 'error');
      return;
    }

    submitButton.disabled = true;
    setPortalMessage('Validando el acceso…');

    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) showPortalError('iniciar sesión', error, 'No pudimos iniciar sesión. Revisa tus datos e inténtalo de nuevo.');
    } catch (error) {
      showPortalError('iniciar sesión', error, 'No pudimos iniciar sesión. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      submitButton.disabled = false;
    }
  });

  document.querySelector('#portal-reset').addEventListener('click', async () => {
    const email = document.querySelector('#portal-email').value.trim();
    if (!email) {
      setPortalMessage('Escribe tu correo electrónico y vuelve a seleccionar “Olvidé mi contraseña”.', 'error');
      document.querySelector('#portal-email').focus();
      return;
    }

    const redirectUrl = new URL(window.location.href);
    redirectUrl.search = '';
    redirectUrl.hash = '';
    setPortalMessage('Enviando el enlace para cambiar tu contraseña…');

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl.toString() });
      if (error) {
        showPortalError('solicitar un cambio de contraseña', error, 'No pudimos enviar el enlace. Revisa la configuración del correo o inténtalo más tarde.');
        return;
      }
      setPortalMessage('Si el correo corresponde a una cuenta activa, recibirás un enlace para cambiar la contraseña.');
    } catch (error) {
      showPortalError('solicitar un cambio de contraseña', error, 'No pudimos enviar el enlace. Inténtalo más tarde.');
    }
  });

  portalPasswordUpdateForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(portalPasswordUpdateForm);
    const password = formData.get('password');
    if (password !== formData.get('password-confirmation')) {
      setPortalMessage('Las contraseñas no coinciden.', 'error');
      return;
    }

    const submitButton = document.querySelector('#portal-password-submit');
    submitButton.disabled = true;
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        showPortalError('actualizar la contraseña', error, 'No pudimos actualizar la contraseña. Solicita un nuevo enlace e inténtalo otra vez.');
        return;
      }
      recoveryMode = false;
      portalPasswordUpdateForm.hidden = true;
      document.querySelector('#portal-password').value = '';
      setPortalMessage('Contraseña actualizada. Ya puedes ingresar con tu cuenta.', 'success');
      portalLoginForm.hidden = false;
    } catch (error) {
      showPortalError('actualizar la contraseña', error, 'No pudimos actualizar la contraseña. Solicita un nuevo enlace e inténtalo otra vez.');
    } finally {
      submitButton.disabled = false;
    }
  });

  document.querySelector('#portal-logout').addEventListener('click', async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) showPortalError('cerrar sesión', error, 'No pudimos cerrar la sesión. Inténtalo de nuevo.');
    } catch (error) {
      showPortalError('cerrar sesión', error, 'No pudimos cerrar la sesión. Inténtalo de nuevo.');
    }
  });

  document.querySelector('#invoice-refresh').addEventListener('click', loadInvoices);

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      recoveryMode = true;
      portalLoginForm.hidden = true;
      portalAccount.hidden = true;
      portalPasswordUpdateForm.hidden = false;
      setPortalMessage('Elige una nueva contraseña para tu cuenta.');
      return;
    }

    if (event === 'USER_UPDATED' && recoveryMode) {
      recoveryMode = false;
      portalPasswordUpdateForm.hidden = true;
      portalLoginForm.hidden = false;
      setPortalMessage('Contraseña actualizada. Ya puedes ingresar con tu cuenta.', 'success');
      return;
    }

    renderSession(session);
    if (session) window.setTimeout(loadInvoices, 0);
  });
}

initializePaymentPortal();
