/**
 * Spanish copy for the "Ask Grizz" guide (UserGuideModal). Keyed by the
 * English SECTIONS ids so the modal keeps its icons/ids and only swaps text.
 * Keep it in step with SECTIONS in UserGuideModal.tsx — same sections, same
 * headings, same lines in the same order. UI names match the Spanish app
 * labels in i18n.ts (Más, Agenda, Despacho, Operaciones, Metas…).
 */
export interface GuideCopy {
  title: string;
  body: { heading?: string; lines: string[] }[];
}

export const SECTIONS_ES: Record<string, GuideCopy> = {
  start: {
    title: "Primeros pasos",
    body: [
      {
        heading: "Configura tu negocio una sola vez",
        lines: [
          "Más → Ajustes del negocio: sube tu logo y agrega el nombre del negocio, n.º de licencia, dirección, teléfono y correo. Aparecen en cada cotización, factura y PDF.",
          "Ahí mismo fija tu tarifa por hora, el margen de materiales % y el impuesto % (Ajustes de Cotización). Las tarifas por oficio tienen prioridad sobre la tarifa por hora para ese oficio.",
          "Más → Operaciones → Equipo → Invitar a un compañero: manda el enlace por mensaje de texto. Cuando se registren recibirás una solicitud — toca Aprobar y luego fija su tarifa de pago.",
        ],
      },
      {
        heading: "La barra de navegación",
        lines: [
          "Cotizar — empieza un presupuesto nuevo con tres opciones: Cotización rápida, Inspección completa o Subir reporte.",
          "Trabajos — todas las cotizaciones y trabajos activos en una lista. Toca una tarjeta para abrir el detalle completo.",
          "Inicio — tu panel: próximo trabajo, resumen del dinero y acciones rápidas.",
          "Tiempo — fichar entrada y salida. Una vez fichado, se convierte en Modo Trabajo — tu cabina de mando en campo.",
          "Más — aquí viven Agenda, Metas, Operaciones, Clientes, Millaje, Ajustes del negocio, el Ayudante de reparación y Pregúntale a Grizz. Toca tu nombre arriba en Más para tus ajustes personales.",
        ],
      },
    ],
  },
  quote: {
    title: "Cómo hacer una cotización",
    body: [
      {
        heading: "Tres formas de empezar",
        lines: [
          "Cotización rápida — escribe lo que hay que hacer (o toma una foto) y la IA lo calcula al instante. Ideal para visitas de seguimiento donde ya conoces el trabajo.",
          "Inspección completa — recorre cada cuarto, marca el estado y adjunta fotos. Adentro, toca Voice Walk para narrar los daños en voz alta — la IA escucha y llena cada punto automáticamente. Ideal para recorridos y entregas de propiedades de administradores.",
          "Subir reporte — pega el PDF de alcance de trabajo que ya tenga el cliente y la IA saca los conceptos directamente.",
        ],
      },
      {
        heading: "Edita antes de enviar",
        lines: [
          "Ajusta cualquier concepto, número de horas o precio de material. La IA aprende de cada edición — las correcciones del mismo código postal pesan más, así que se afina en tu mercado.",
          "Toca MAT en un concepto para abrir el editor de materiales. El desglose de cantidad × unidad se imprime en el PDF de la cotización.",
          "Toca el botón Render en la barra de acciones para generar una imagen de antes y después con IA a partir del alcance de tu cotización — adjúntala para impresionar a los clientes.",
          "Guardar → el trabajo aparece en Trabajos como Cotizado.",
        ],
      },
      {
        heading: "Envíala",
        lines: [
          "Desde la barra de acciones toca PDF para imprimir, o Enviar para copiar el enlace de estado del cliente.",
          "El cliente abre el enlace, revisa el alcance y toca Aprobar y Firmar. El trabajo pasa solo a Aceptado y el PDF firmado se guarda en su portal.",
        ],
      },
    ],
  },
  work: {
    title: "Cómo hacer un trabajo",
    body: [
      {
        heading: "Agéndalo primero",
        lines: [
          "Abre Agenda (Más → Agenda) y toca Despacho. Aquí aparecen todos los trabajos aceptados y cotizados que aún no están en el calendario.",
          "Toca Asignar en cualquier trabajo para elegir fecha y equipo — se coloca en el calendario y avisa al técnico asignado.",
        ],
      },
      {
        heading: "Ficha tu entrada",
        lines: [
          "Toca Fichar Entrada en el panel o elige un trabajo de la lista de hoy. El tiempo se registra en ese trabajo específico — las visitas de seguimiento en la misma dirección no mezclan las horas.",
          "El Modo Trabajo se abre solo cuando estás fichado.",
        ],
      },
      {
        heading: "Pestañas del Modo Trabajo",
        lines: [
          "Tareas — lista agrupada por oficio. Toca una tarea para tomar una foto de tu avance.",
          "Guía — instrucciones paso a paso con una lista de compras en vivo que puedes marcar y editar sobre la marcha.",
          "Notas — notas libres de campo que se imprimen en el reporte de finalización.",
          "Fotos — antes / trabajo / después. Toca el botón de destello en cualquier foto para generar un render de después con IA.",
        ],
      },
      {
        heading: "Recibos sobre la marcha",
        lines: [
          "Fotografía cada recibo de la tienda en Modo Trabajo → Fotos → Escanear recibo. La IA lee los conceptos, los usa para aprender a cotizar y reemplaza el costo estimado de materiales por tu costo real en el cálculo de ganancias.",
        ],
      },
    ],
  },
  bill: {
    title: "Cómo cobrar",
    body: [
      {
        heading: "Marcar como terminado",
        lines: [
          "Toca Completar trabajo al final de la pestaña Tareas del Modo Trabajo, o cambia el estado en Trabajos. Se genera un PDF de reporte de finalización con tu lista y tus fotos.",
          "Toca Enviar factura para mandar la cuenta por texto (con enlace de pago) — eso la marca como Facturada. ¿Te pagaron en efectivo, cheque o Zelle? Toca Registrar pago e ingresa el monto.",
        ],
      },
      {
        heading: "Pagos con Stripe",
        lines: [
          "Conecta Stripe una sola vez en Más → Operaciones → Pagos y plan. Después, la página del trabajo del cliente muestra un botón de Pagar.",
          "Cuando pagan, el trabajo pasa solo a Pagado mediante el webhook de Stripe — no tienes que tocar nada.",
        ],
      },
      {
        heading: "Solicitud de reseña automática",
        lines: [
          "Cuando un trabajo llega a Pagado, la app programa sola un mensaje de solicitud de reseña para 24 horas después (se configura en Más → Ajustes del negocio → Automatización de reseñas).",
          "El mensaje lleva directo a tu página de reseñas de Google. También puedes enviar uno manualmente desde la sección Administrar del trabajo.",
        ],
      },
    ],
  },
  ops: {
    title: "Cómo manejar el negocio",
    body: [
      {
        heading: "Centro de Operaciones",
        lines: [
          "Más → Operaciones abre una cuadrícula de mosaicos. Toca cualquiera para entrar a fondo: Nómina, Finanzas, Clientes, Recurrentes, RR. HH., Equipo, Pagos y plan, Ajustes del negocio.",
          "Nómina — paga a tu equipo. Las horas se marcan como pagadas (no se borran) para que las Estadísticas del equipo conserven el historial completo.",
          "Finanzas — ingresos, ganancias, antigüedad de cuentas por cobrar, desglose por oficio y mejores clientes. Imprime un estado de resultados de cualquier periodo.",
          "RR. HH. — aprueba o rechaza solicitudes de tiempo libre.",
          "Recurrentes — configura calendarios de servicio automáticos (semanales, mensuales, etc.) que crean trabajos nuevos por sí solos.",
        ],
      },
      {
        heading: "Metas y bonos",
        lines: [
          "Más → Metas muestra tus misiones activas: objetivos de reseñas, de referidos y rachas de trabajos terminados. Cumplirlas desbloquea bonos en efectivo que se pagan con la nómina.",
          "La tabla del Equipo ordena a todos por lo ganado en metas durante el ciclo — competencia sana.",
        ],
      },
      {
        heading: "Notificaciones",
        lines: [
          "La campana en el panel muestra nuevas asignaciones de trabajo y prospectos que llegan. Toca una notificación para ir directo a ese trabajo.",
          "Activa las alertas push en el panel de notificaciones para recibir avisos aunque la app esté cerrada (en iOS requiere instalar Creed en tu pantalla de inicio).",
        ],
      },
      {
        heading: "Portal del cliente y tarjeta digital",
        lines: [
          "Genera un enlace mágico del portal desde Clientes → cualquier cliente → Enlace del portal. Verán sus cotizaciones, trabajos agendados y terminados, y podrán descargar documentos.",
          "Tu tarjeta de presentación digital está en el panel — tócala para ver el código QR y el enlace para compartir.",
        ],
      },
    ],
  },
  tips: {
    title: "Consejos y solución de problemas",
    body: [
      {
        heading: "Las cotizaciones de la IA no cuadran",
        lines: [
          "Edita el precio o las horas de los conceptos que la IA falló y guarda. Las próximas cotizaciones del mismo código postal tomarán en cuenta tus correcciones — aprende rápido.",
          "Fija tarifas por oficio en Ops → Ajustes del negocio si tu tarifa de plomería es distinta a la de carpintería; la IA las usa para la mano de obra.",
        ],
      },
      {
        heading: "Trabajos sin agendar",
        lines: [
          "Si un trabajo no aparece en el calendario, ve a Agenda → Despacho. Todos los trabajos aceptados o cotizados sin fecha se juntan ahí — toca Asignar para ubicarlos.",
        ],
      },
      {
        heading: "Dos trabajos en la misma propiedad",
        lines: [
          "Las horas se registran por trabajo, no por dirección, así que una visita de seguimiento en una propiedad con un trabajo anterior no mezcla el historial.",
        ],
      },
      {
        heading: "La actividad del equipo se ve mal",
        lines: [
          "Si alguien aparece fichado pero no lo está, busca un registro de tiempo abierto de un día anterior. Puedes cerrarlo manualmente desde Tiempo → Equipo → su tarjeta → Forzar salida.",
        ],
      },
      {
        heading: "Cotizaciones que nunca vas a ganar",
        lines: [
          "En Trabajos, archívalas. Conservan su estado, así que al restaurarlas vuelven tal cual, pero desaparecen del embudo activo.",
        ],
      },
    ],
  },
};
