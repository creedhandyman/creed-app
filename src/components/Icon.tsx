"use client";
/**
 * Single source of truth for icons across the app. Maps semantic names to
 * Lucide React icons so every screen draws from a consistent stroke-width
 * and size system. To swap icon library later, change one place.
 *
 * Usage: <Icon name="quote" size={18} />
 */
import {
  Zap,
  ClipboardList,
  Calendar,
  Clock,
  Target,
  Building2,
  Users,
  Car,
  Megaphone,
  Wrench,
  Settings,
  Home,
  DollarSign,
  Globe,
  Wallet,
  Search,
  Camera,
  Image as ImageIcon,
  Plus,
  X,
  Trash2,
  Pencil,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Check,
  AlertTriangle,
  Info,
  Play,
  Square,
  Pause,
  RefreshCw,
  Upload,
  Download,
  Send,
  QrCode,
  Hammer,
  PaintBucket,
  Lightbulb,
  Droplet,
  ShieldCheck,
  Award,
  Receipt,
  Package,
  Map as MapIcon,
  PhoneCall,
  Mail,
  Star,
  TrendingUp,
  PlugZap,
  ListChecks,
  FilePlus,
  FileText,
  Rocket,
  Briefcase,
  HardHat,
  Filter,
  Sparkles,
  CircleDot,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  // Navigation
  quote: Zap,
  jobs: ClipboardList,
  schedule: Calendar,
  time: Clock,
  quest: Target,
  ops: Building2,
  clients: Users,
  mileage: Car,
  marketing: Megaphone,
  troubleshoot: Wrench,
  settings: Settings,
  home: Home,
  pay: Wallet,
  site: Globe,

  // Common UI
  search: Search,
  camera: Camera,
  photo: ImageIcon,
  add: Plus,
  close: X,
  delete: Trash2,
  edit: Pencil,
  back: ChevronLeft,
  next: ChevronRight,
  expand: ChevronDown,
  collapse: ChevronUp,
  check: Check,
  warn: AlertTriangle,
  info: Info,
  start: Play,
  stop: Square,
  pause: Pause,
  refresh: RefreshCw,
  upload: Upload,
  download: Download,
  send: Send,
  qr: QrCode,
  filter: Filter,

  // Trades / context
  hammer: Hammer,
  paint: PaintBucket,
  electric: Lightbulb,
  plumbing: Droplet,
  safety: ShieldCheck,
  hvac: PlugZap,
  award: Award,
  receipt: Receipt,
  package: Package,
  map: MapIcon,
  phone: PhoneCall,
  mail: Mail,
  star: Star,
  trending: TrendingUp,
  briefcase: Briefcase,
  worker: HardHat,
  rocket: Rocket,
  doc: FileText,
  newDoc: FilePlus,
  list: ListChecks,
  money: DollarSign,
  sparkle: Sparkles,
  dot: CircleDot,
};

export type IconName = keyof typeof ICONS | string;

interface Props {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Render a Lucide icon by semantic name. Falls back gracefully if the
 * name isn't mapped — renders nothing rather than crashing.
 */
export function Icon({ name, size = 18, color, strokeWidth = 1.75, className, style }: Props) {
  const C = ICONS[name];
  if (!C) return null;
  return (
    <C
      size={size}
      color={color}
      strokeWidth={strokeWidth}
      className={className}
      style={{ flexShrink: 0, ...style }}
      aria-hidden
    />
  );
}

export default Icon;
