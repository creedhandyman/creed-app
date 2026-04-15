// Creed App — Internationalization
// Add new languages by adding a new object to the translations map

export type Lang = "en" | "es";

const translations: Record<Lang, Record<string, string>> = {
  en: {
    // Nav
    "nav.quote": "Quote",
    "nav.jobs": "Jobs",
    "nav.sched": "Sched",
    "nav.time": "Time",
    "nav.pay": "Pay",
    "nav.quest": "Quest",
    "nav.site": "Site",
    "nav.ops": "Ops",
    "nav.clients": "Clients",

    // Dashboard
    "dash.welcome": "Welcome",
    "dash.nextJob": "Next Job",
    "dash.closestQuest": "Closest Quest",
    "dash.earnedMonth": "Earned This Month",
    "dash.netPay": "Net Pay This Week",
    "dash.startQuote": "Start a Quote",
    "dash.startQuoteDesc": "Upload a PDF, paste an inspection, or build from scratch",
    "dash.clients": "Clients",
    "dash.contacts": "contacts",
    "dash.mileage": "Mileage",
    "dash.trackTrips": "Track trips",
    "dash.troubleshoot": "Troubleshoot",
    "dash.aiDiagnosis": "AI diagnosis",
    "dash.marketing": "Marketing & Website",
    "dash.siteLive": "Your site is live — manage links & reviews",
    "dash.buildSite": "Build a free website with AI in 60 seconds",
    "dash.gettingStarted": "Getting Started",
    "dash.complete": "complete",

    // QuoteForge
    "qf.title": "Quote",
    "qf.uploadPdf": "Upload PDF",
    "qf.pasteInspection": "Paste Inspection",
    "qf.manual": "Manual Build",
    "qf.quickQuote": "Quick Quote",
    "qf.fullInspection": "Full Inspection",
    "qf.property": "Property address",
    "qf.saveJob": "Save Job",
    "qf.exportPdf": "Export PDF",
    "qf.addItem": "Add Item",
    "qf.room": "Trade / Room",
    "qf.description": "Description",
    "qf.comment": "Comment / Notes",
    "qf.hours": "Hours",
    "qf.materials": "Materials",
    "qf.total": "Total",
    "qf.labor": "Labor",
    "qf.aiAssist": "AI Assist",

    // Jobs
    "jobs.active": "Active",
    "jobs.billing": "Billing",
    "jobs.paid": "Paid",
    "jobs.noActive": "No active jobs — create one in QuoteForge",
    "jobs.noBilling": "No jobs ready for billing",
    "jobs.noPaid": "No paid jobs yet",
    "jobs.editQuote": "Edit Quote",
    "jobs.scheduleThis": "Schedule This",
    "jobs.jobReport": "Job Report",
    "jobs.sendClient": "Send to Client",
    "jobs.delete": "Delete",
    "jobs.generateInvoice": "Generate Invoice",
    "jobs.viewInvoice": "View Invoice",
    "jobs.jobNotes": "Add job notes...",
    "jobs.connectStripe": "Connect Stripe",

    // Schedule
    "sched.title": "Schedule",
    "sched.selectJob": "Select job",
    "sched.add": "Add",
    "sched.printSchedule": "Print Schedule",
    "sched.noJobs": "No jobs scheduled",

    // Timer
    "timer.title": "Timer",
    "timer.start": "Start",
    "timer.stop": "Stop",
    "timer.general": "General",
    "timer.manualEntry": "Manual Entry",
    "timer.myLog": "My Log",
    "timer.crewActivity": "Crew Activity — Today",
    "timer.log": "Log",

    // Payroll
    "pay.title": "Payroll",
    "pay.processPay": "Process Pay",
    "pay.byJob": "By Job",
    "pay.noEntries": "No time entries",
    "pay.history": "History",

    // Quests
    "quest.title": "Quest Hub",
    "quest.quests": "Quests",
    "quest.team": "Team",
    "quest.reviews": "Reviews",
    "quest.referrals": "Referrals",
    "quest.done": "Done",
    "quest.earned": "Earned",
    "quest.maxPayout": "Max Payout",
    "quest.hours": "Hours",
    "quest.untilReset": "until reset",
    "quest.maxAnnual": "Max Annual Payout",
    "quest.perCycle": "per cycle",
    "quest.cyclesYear": "cycles/year",
    "quest.addReview": "Add Review",
    "quest.addReferral": "Add Referral",
    "quest.copyLink": "Copy Link",

    // Settings
    "settings.title": "Settings",
    "settings.account": "Account",
    "settings.team": "Team",
    "settings.operations": "Operations",
    "settings.payments": "Payments",
    "settings.general": "General",
    "settings.businessInfo": "Business Info",
    "settings.yourProfile": "Your Profile",
    "settings.changePassword": "Change Password",
    "settings.save": "Save",
    "settings.appearance": "Appearance",
    "settings.darkMode": "Dark Mode",
    "settings.navigation": "Navigation",
    "settings.language": "Language",
    "settings.logout": "Logout",
    "settings.deleteAccount": "Delete Account",

    // Common
    "common.cancel": "Cancel",
    "common.confirm": "Confirm",
    "common.delete": "Delete",
    "common.close": "Close",
    "common.back": "Back",
    "common.done": "Done",
    "common.loading": "Loading...",
    "common.search": "Search",
    "common.noResults": "No results",
  },

  es: {
    // Nav
    "nav.quote": "Cotizar",
    "nav.jobs": "Trabajos",
    "nav.sched": "Agenda",
    "nav.time": "Tiempo",
    "nav.pay": "Pago",
    "nav.quest": "Metas",
    "nav.site": "Sitio",
    "nav.ops": "Ops",
    "nav.clients": "Clientes",

    // Dashboard
    "dash.welcome": "Bienvenido",
    "dash.nextJob": "Pr\u00f3ximo Trabajo",
    "dash.closestQuest": "Meta M\u00e1s Cercana",
    "dash.earnedMonth": "Ganado Este Mes",
    "dash.netPay": "Pago Neto Esta Semana",
    "dash.startQuote": "Crear Cotizaci\u00f3n",
    "dash.startQuoteDesc": "Sube un PDF, pega una inspecci\u00f3n, o crea desde cero",
    "dash.clients": "Clientes",
    "dash.contacts": "contactos",
    "dash.mileage": "Millaje",
    "dash.trackTrips": "Registrar viajes",
    "dash.troubleshoot": "Diagn\u00f3stico",
    "dash.aiDiagnosis": "Diagn\u00f3stico IA",
    "dash.marketing": "Marketing y Sitio Web",
    "dash.siteLive": "Tu sitio est\u00e1 activo — gestiona enlaces y rese\u00f1as",
    "dash.buildSite": "Crea un sitio web gratis con IA en 60 segundos",
    "dash.gettingStarted": "Primeros Pasos",
    "dash.complete": "completado",

    // QuoteForge
    "qf.title": "Cotizaci\u00f3n",
    "qf.uploadPdf": "Subir PDF",
    "qf.pasteInspection": "Pegar Inspecci\u00f3n",
    "qf.manual": "Crear Manual",
    "qf.quickQuote": "Cotizaci\u00f3n R\u00e1pida",
    "qf.fullInspection": "Inspecci\u00f3n Completa",
    "qf.property": "Direcci\u00f3n de la propiedad",
    "qf.saveJob": "Guardar Trabajo",
    "qf.exportPdf": "Exportar PDF",
    "qf.addItem": "Agregar \u00cdtem",
    "qf.room": "Oficio / \u00c1rea",
    "qf.description": "Descripci\u00f3n",
    "qf.comment": "Comentario / Notas",
    "qf.hours": "Horas",
    "qf.materials": "Materiales",
    "qf.total": "Total",
    "qf.labor": "Mano de Obra",
    "qf.aiAssist": "Asistente IA",

    // Jobs
    "jobs.active": "Activos",
    "jobs.billing": "Facturaci\u00f3n",
    "jobs.paid": "Pagados",
    "jobs.noActive": "Sin trabajos activos \u2014 crea uno en Cotizaci\u00f3n",
    "jobs.noBilling": "Sin trabajos para facturar",
    "jobs.noPaid": "Sin trabajos pagados a\u00fan",
    "jobs.editQuote": "Editar Cotizaci\u00f3n",
    "jobs.scheduleThis": "Agendar Este",
    "jobs.jobReport": "Reporte de Trabajo",
    "jobs.sendClient": "Enviar al Cliente",
    "jobs.delete": "Eliminar",
    "jobs.generateInvoice": "Generar Factura",
    "jobs.viewInvoice": "Ver Factura",
    "jobs.jobNotes": "Agregar notas del trabajo...",
    "jobs.connectStripe": "Conectar Stripe",

    // Schedule
    "sched.title": "Agenda",
    "sched.selectJob": "Seleccionar trabajo",
    "sched.add": "Agregar",
    "sched.printSchedule": "Imprimir Agenda",
    "sched.noJobs": "Sin trabajos agendados",

    // Timer
    "timer.title": "Cron\u00f3metro",
    "timer.start": "Iniciar",
    "timer.stop": "Detener",
    "timer.general": "General",
    "timer.manualEntry": "Entrada Manual",
    "timer.myLog": "Mi Registro",
    "timer.crewActivity": "Actividad del Equipo \u2014 Hoy",
    "timer.log": "Registrar",

    // Payroll
    "pay.title": "N\u00f3mina",
    "pay.processPay": "Procesar Pago",
    "pay.byJob": "Por Trabajo",
    "pay.noEntries": "Sin entradas de tiempo",
    "pay.history": "Historial",

    // Quests
    "quest.title": "Centro de Metas",
    "quest.quests": "Metas",
    "quest.team": "Equipo",
    "quest.reviews": "Rese\u00f1as",
    "quest.referrals": "Referencias",
    "quest.done": "Hechas",
    "quest.earned": "Ganado",
    "quest.maxPayout": "Pago M\u00e1ximo",
    "quest.hours": "Horas",
    "quest.untilReset": "para reinicio",
    "quest.maxAnnual": "Pago M\u00e1ximo Anual",
    "quest.perCycle": "por ciclo",
    "quest.cyclesYear": "ciclos/a\u00f1o",
    "quest.addReview": "Agregar Rese\u00f1a",
    "quest.addReferral": "Agregar Referencia",
    "quest.copyLink": "Copiar Enlace",

    // Settings
    "settings.title": "Configuraci\u00f3n",
    "settings.account": "Cuenta",
    "settings.team": "Equipo",
    "settings.operations": "Operaciones",
    "settings.payments": "Pagos",
    "settings.general": "General",
    "settings.businessInfo": "Info del Negocio",
    "settings.yourProfile": "Tu Perfil",
    "settings.changePassword": "Cambiar Contrase\u00f1a",
    "settings.save": "Guardar",
    "settings.appearance": "Apariencia",
    "settings.darkMode": "Modo Oscuro",
    "settings.navigation": "Navegaci\u00f3n",
    "settings.language": "Idioma",
    "settings.logout": "Cerrar Sesi\u00f3n",
    "settings.deleteAccount": "Eliminar Cuenta",

    // Common
    "common.cancel": "Cancelar",
    "common.confirm": "Confirmar",
    "common.delete": "Eliminar",
    "common.close": "Cerrar",
    "common.back": "Atr\u00e1s",
    "common.done": "Listo",
    "common.loading": "Cargando...",
    "common.search": "Buscar",
    "common.noResults": "Sin resultados",
  },
};

// Get current language from localStorage
export function getLang(): Lang {
  if (typeof window === "undefined") return "en";
  return (localStorage.getItem("c_lang") as Lang) || "en";
}

export function setLang(lang: Lang) {
  localStorage.setItem("c_lang", lang);
}

// Translation function
export function t(key: string): string {
  const lang = getLang();
  return translations[lang]?.[key] || translations.en[key] || key;
}

// Hook-compatible getter
export function useT() {
  return t;
}
