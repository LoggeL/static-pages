'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import {
  BarChart as RechartsBarChart,
  Bar,
  CartesianGrid,
  XAxis,
} from 'recharts';
import {
  ArrowLeft,
  BarChart3,
  Bell,
  BellRing,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  Download,
  ExternalLink,
  LayoutDashboard,
  LockKeyhole,
  MapPin,
  Megaphone,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserCheck,
  Users,
  Vote,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type View = 'dashboard' | 'calendar' | 'polls' | 'stats' | 'admin' | 'checkin';
type Attendance = 'yes' | 'no';

type EventItem = {
  id: string;
  day: number;
  month: string;
  weekday: string;
  title: string;
  time: string;
  place: string;
  group: string;
  people: number;
  type: 'weekly' | 'other';
  tone: 'orange' | 'violet' | 'blue' | 'green';
  locked?: boolean;
};

const baseEvents: EventItem[] = [
  {
    id: 'weekly-03',
    day: 3,
    month: 'SEP',
    weekday: 'Donnerstag',
    title: 'Wochenprobe „Creepshow“',
    time: '19:00–21:00',
    place: 'Kolpingheim · Großer Saal',
    group: 'Creepshow-Ensemble',
    people: 24,
    type: 'weekly',
    tone: 'orange',
  },
  {
    id: 'scene-07',
    day: 7,
    month: 'SEP',
    weekday: 'Montag',
    title: 'Szenenprobe · Villa Falkenstein',
    time: '18:30–20:30',
    place: 'Kolpingheim · Kleiner Saal',
    group: 'Ensemble',
    people: 14,
    type: 'other',
    tone: 'blue',
  },
  {
    id: 'costume-12',
    day: 12,
    month: 'SEP',
    weekday: 'Samstag',
    title: 'Maskenball · Kostüm & Maske',
    time: '10:00–13:00',
    place: 'Fundus',
    group: 'Kostümteam',
    people: 6,
    type: 'other',
    tone: 'violet',
  },
  {
    id: 'tech-16',
    day: 16,
    month: 'SEP',
    weekday: 'Mittwoch',
    title: 'Technikdurchlauf · Open-Air-Bühne',
    time: '18:00–21:00',
    place: 'Bühne',
    group: 'Technik & Ensemble',
    people: 18,
    type: 'other',
    tone: 'green',
    locked: true,
  },
  {
    id: 'weekly-24',
    day: 24,
    month: 'SEP',
    weekday: 'Donnerstag',
    title: 'Wochenprobe · Creepshow-Finale',
    time: '19:00–21:00',
    place: 'Kolpingheim · Großer Saal',
    group: 'Alle',
    people: 31,
    type: 'weekly',
    tone: 'orange',
  },
];

const memberSeed = [
  { id: 1, name: 'Logge', group: 'Ensemble · Bote / Diener', initials: 'LO', present: true },
  { id: 2, name: 'Noah Becker', group: 'Jugend', initials: 'NB', present: true },
  { id: 3, name: 'Mia Wagner', group: 'Jugend', initials: 'MW', present: false },
  { id: 4, name: 'Jonas Hoffmann', group: 'Ensemble', initials: 'JH', present: true },
  { id: 5, name: 'Sarah Klein', group: 'Ensemble', initials: 'SK', present: true },
  { id: 6, name: 'Tobias Hartmann', group: 'Ensemble', initials: 'TH', present: false },
  { id: 7, name: 'Emilia Schmitt', group: 'Jugend', initials: 'ES', present: true },
  { id: 8, name: 'Felix Braun', group: 'Technik', initials: 'FB', present: true },
];

const chartData = [
  { month: 'Apr', attendance: 74, target: 85 },
  { month: 'Mai', attendance: 79, target: 85 },
  { month: 'Jun', attendance: 84, target: 85 },
  { month: 'Jul', attendance: 81, target: 85 },
  { month: 'Aug', attendance: 88, target: 85 },
  { month: 'Sep', attendance: 92, target: 85 },
];

const chartConfig = {
  attendance: { label: 'Anwesenheit', color: '#c94f1d' },
  target: { label: 'Ziel', color: '#c9c5be' },
} satisfies ChartConfig;

const toneClasses = {
  orange: 'bg-primary',
  violet: 'bg-violet-400',
  blue: 'bg-sky-400',
  green: 'bg-emerald-400',
};

const navItems: Array<{ label: string; icon: typeof LayoutDashboard; view: View; badge?: string }> = [
  { label: 'Übersicht', icon: LayoutDashboard, view: 'dashboard' },
  { label: 'Kalender', icon: CalendarDays, view: 'calendar' },
  { label: 'Abstimmungen', icon: Vote, view: 'polls', badge: '1' },
  { label: 'Statistik', icon: BarChart3, view: 'stats' },
];

const pollOptions = [
  { id: 'fri', day: 'FR · 18 SEP', time: '18:30–21:00', votes: 12 },
  { id: 'sat', day: 'SA · 19 SEP', time: '14:00–17:00', votes: 19 },
  { id: 'sun', day: 'SO · 20 SEP', time: '10:00–13:00', votes: 8 },
];

function SectionHeading({ kicker, title, action }: { kicker: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="font-mono text-[9px] font-bold uppercase tracking-[0.32em] text-primary">{kicker}</p>
        <h2 className="mt-2 text-2xl font-black uppercase tracking-[-0.035em] sm:text-3xl">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function StatusPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warning' }) {
  const tones = {
    neutral: 'border-border bg-background text-muted-foreground',
    success: 'border-emerald-600/25 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-600/25 bg-amber-50 text-amber-700',
  };
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] ${tones[tone]}`}>{children}</span>;
}

function MemberAvatars({ count = 4 }: { count?: number }) {
  return (
    <div className="flex -space-x-2" aria-label={`${count} beispielhafte Teilnehmende`}>
      {memberSeed.slice(0, count).map((member, index) => (
        <div key={member.id} title={member.name} className="grid size-8 place-items-center rounded-full border-2 border-card bg-muted text-[9px] font-bold" style={{ zIndex: count - index }}>
          {member.initials}
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>('dashboard');
  const [attendance, setAttendance] = useState<Attendance>('yes');
  const [notice, setNotice] = useState('Du bist automatisch als dabei eingetragen.');
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
  const [absenceOpen, setAbsenceOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [absenceSaved, setAbsenceSaved] = useState(false);
  const [customEvent, setCustomEvent] = useState<EventItem | null>(null);
  const [pollChoice, setPollChoice] = useState('sat');
  const [pollConfirmed, setPollConfirmed] = useState(false);
  const [members, setMembers] = useState(memberSeed);
  const [checkinSaved, setCheckinSaved] = useState(false);
  const [adminNotice, setAdminNotice] = useState('');
  const [reminders, setReminders] = useState({ dayBefore: true, twoHours: true, changes: true });

  const events = useMemo(() => {
    const items = [...baseEvents];
    if (pollConfirmed) {
      items.push({
        id: 'poll-result',
        day: 19,
        month: 'SEP',
        weekday: 'Samstag',
        title: 'Zusatzprobe · Maskenball',
        time: '14:00–17:00',
        place: 'Kolpingheim · Großer Saal',
        group: 'Alle Getaggten',
        people: 19,
        type: 'other',
        tone: 'blue',
      });
    }
    if (customEvent) items.push(customEvent);
    return items;
  }, [customEvent, pollConfirmed]);

  const presentCount = members.filter((member) => member.present).length;

  const navigate = (next: View) => {
    setView(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const setResponse = (response: Attendance) => {
    setAttendance(response);
    setNotice(
      response === 'yes'
        ? 'Zusage gespeichert – schön, dass du dabei bist!'
        : 'Absage gespeichert. Diese Wochenprobe kann bis 17:00 Uhr abgesagt werden.',
    );
  };

  const openEvent = (event: EventItem) => setSelectedEvent(event);

  const downloadIcs = (event: EventItem) => {
    const startHour = event.time.slice(0, 2);
    const endHour = event.time.slice(6, 8);
    const padDay = String(event.day).padStart(2, '0');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Buehnenplan//Kolpingtheater//DE',
      'BEGIN:VEVENT',
      `UID:${event.id}@buehnenplan`,
      `DTSTART:202609${padDay}T${startHour}0000`,
      `DTEND:202609${padDay}T${endHour}0000`,
      `SUMMARY:${event.title}`,
      `LOCATION:${event.place}`,
      `DESCRIPTION:Gruppe: ${event.group}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${event.id}.ics`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice('Kalenderdatei wurde erstellt. Sie funktioniert mit Apple Kalender und Outlook.');
  };

  const openGoogleCalendar = (event: EventItem) => {
    const day = String(event.day).padStart(2, '0');
    const startHour = event.time.slice(0, 2);
    const endHour = event.time.slice(6, 8);
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: event.title,
      dates: `202609${day}T${startHour}0000/202609${day}T${endHour}0000`,
      location: event.place,
      details: `Gruppe: ${event.group}`,
    });
    window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, '_blank', 'noopener,noreferrer');
  };

  const createEvent = (formData: FormData) => {
    const rawTitle = formData.get('title');
    const rawGroup = formData.get('group');
    const title = typeof rawTitle === 'string' && rawTitle ? rawTitle : 'Neue Probe';
    const group = typeof rawGroup === 'string' && rawGroup ? rawGroup : 'Alle';
    setCustomEvent({
      id: 'custom-event',
      day: 27,
      month: 'SEP',
      weekday: 'Sonntag',
      title,
      time: '15:00–17:00',
      place: 'Kolpingheim · Großer Saal',
      group,
      people: 0,
      type: 'other',
      tone: 'violet',
    });
    setEventOpen(false);
    setAdminNotice(`„${title}“ wurde angelegt und die getaggte Gruppe wird erinnert.`);
  };

  const confirmPoll = () => {
    setPollConfirmed(true);
    setAdminNotice('Der meistgewählte Termin wurde bestätigt und automatisch in den Kalender übernommen.');
  };

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-sidebar lg:flex">
        <div className="flex h-20 items-center border-b border-border px-7">
          <Image src="theater-logo.png" alt="" aria-hidden="true" width={40} height={40} priority unoptimized className="mr-3 size-10 object-contain" />
          <div>
            <p className="font-black uppercase leading-none tracking-[-0.03em]">Kolping</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.28em] text-primary">Theater Ramsen</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 py-7" aria-label="Hauptnavigation">
          <p className="px-3 font-mono text-[9px] uppercase tracking-[0.32em] text-muted-foreground">Meine Bühne</p>
          <div className="mt-3 space-y-1">
            {navItems.map((item) => (
              <button key={item.label} type="button" onClick={() => navigate(item.view)} className={`group flex w-full items-center gap-3 rounded-sm px-3 py-3 text-left text-sm transition ${view === item.view ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                <item.icon className="size-4" />
                <span className="flex-1 font-medium">{item.label}</span>
                {item.badge && !pollConfirmed && <span className="grid size-5 place-items-center rounded-full bg-foreground text-[10px] font-bold text-background">{item.badge}</span>}
              </button>
            ))}
          </div>

          <p className="mt-8 px-3 font-mono text-[9px] uppercase tracking-[0.32em] text-muted-foreground">Organisation</p>
          <div className="mt-3 space-y-1">
            <button type="button" onClick={() => navigate('admin')} className={`flex w-full items-center gap-3 rounded-sm px-3 py-3 text-left text-sm transition ${view === 'admin' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
              <ShieldCheck className="size-4" /><span className="font-medium">Adminbereich</span>
            </button>
            <button type="button" onClick={() => navigate('checkin')} className={`flex w-full items-center gap-3 rounded-sm px-3 py-3 text-left text-sm transition ${view === 'checkin' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
              <ClipboardCheck className="size-4" /><span className="font-medium">Proben-Check-in</span>
            </button>
          </div>
        </nav>

        <div className="border-t border-border p-4">
          <button type="button" onClick={() => navigate('dashboard')} className="flex w-full items-center gap-3 rounded-sm bg-muted/50 p-3 text-left hover:bg-muted">
            <div className="grid size-9 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">LO</div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">Logge</p><p className="truncate text-xs text-muted-foreground">Bote / Diener</p></div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
        </div>
      </aside>

      <main className="min-h-screen pb-24 lg:ml-64 lg:pb-10">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/90 px-5 backdrop-blur-xl sm:px-8 lg:h-20 lg:px-10">
          <button type="button" onClick={() => navigate('dashboard')} className="flex items-center gap-3 lg:hidden">
            <Image src="theater-logo.png" alt="" aria-hidden="true" width={36} height={36} priority unoptimized className="size-9 object-contain" />
            <span className="font-black uppercase tracking-tight">Kolping Theater</span>
          </button>
          <div className="hidden lg:block">
            <p className="font-mono text-[9px] uppercase tracking-[0.32em] text-primary">Dienstag · 01. September 2026</p>
            <h1 className="mt-1 text-xl font-black tracking-tight">{view === 'dashboard' ? 'Hallo Logge' : navItems.find((item) => item.view === view)?.label ?? (view === 'admin' ? 'Adminbereich' : 'Proben-Check-in')}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="mr-2 hidden rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-[8px] uppercase tracking-[0.18em] text-primary sm:inline-flex">Klickprototyp · Beispieldaten</span>
            <button type="button" aria-label="Benachrichtigungen" className="relative grid size-10 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary hover:text-primary">
              <Bell className="size-4" /><span className="absolute right-2 top-2 size-1.5 rounded-full bg-primary" />
            </button>
            <div className="grid size-10 place-items-center rounded-full bg-primary text-xs font-black text-primary-foreground lg:hidden">LO</div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
          {view === 'dashboard' && (
            <DashboardView
              attendance={attendance}
              notice={notice}
              setResponse={setResponse}
              events={events}
              openEvent={openEvent}
              openAbsence={() => setAbsenceOpen(true)}
              navigate={navigate}
              reminders={reminders}
              setReminders={setReminders}
              downloadIcs={downloadIcs}
            />
          )}
          {view === 'calendar' && <CalendarView events={events} openEvent={openEvent} openCreate={() => setEventOpen(true)} />}
          {view === 'polls' && (
            <PollsView
              choice={pollChoice}
              setChoice={setPollChoice}
              confirmed={pollConfirmed}
              navigate={navigate}
            />
          )}
          {view === 'stats' && <StatsView />}
          {view === 'admin' && (
            <AdminView
              notice={adminNotice}
              pollConfirmed={pollConfirmed}
              confirmPoll={confirmPoll}
              openCreate={() => setEventOpen(true)}
              navigate={navigate}
              customEvent={customEvent}
            />
          )}
          {view === 'checkin' && (
            <CheckinView
              members={members}
              setMembers={setMembers}
              saved={checkinSaved}
              setSaved={setCheckinSaved}
              presentCount={presentCount}
              navigate={navigate}
            />
          )}
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-sidebar/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden" aria-label="Mobile Navigation">
        {[...navItems, { label: 'Check-in', icon: ClipboardCheck, view: 'checkin' as View }].map((item) => (
          <button key={item.label} type="button" onClick={() => navigate(item.view)} className={`flex min-w-0 flex-col items-center gap-1 rounded-sm py-1.5 ${view === item.view ? 'text-primary' : 'text-muted-foreground'}`}>
            <item.icon className="size-5" /><span className="max-w-full truncate text-[9px]">{item.label}</span>
          </button>
        ))}
      </nav>

      <EventDialog event={selectedEvent} onClose={() => setSelectedEvent(null)} attendance={attendance} setResponse={setResponse} downloadIcs={downloadIcs} openGoogleCalendar={openGoogleCalendar} />

      <Dialog open={absenceOpen} onOpenChange={setAbsenceOpen}>
        <DialogContent className="border border-border bg-popover sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-black uppercase tracking-tight">Längere Abwesenheit melden</DialogTitle>
            <DialogDescription>Termine in diesem Zeitraum werden automatisch als entschuldigt markiert. Die Probenleitung wird informiert.</DialogDescription>
          </DialogHeader>
          {absenceSaved ? (
              <div className="border border-emerald-600/25 bg-emerald-50 p-5 text-sm text-emerald-700">
              <Check className="mb-3 size-6" /><p className="font-bold">Abwesenheit gespeichert</p><p className="mt-1 text-emerald-700/75">12.–18. Oktober · Familienurlaub</p>
            </div>
          ) : (
            <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); setAbsenceSaved(true); }}>
              <div className="grid grid-cols-2 gap-3"><label htmlFor="absence-from" className="grid gap-2 text-xs font-medium">Von<Input id="absence-from" required type="date" defaultValue="2026-10-12" className="h-11 rounded-sm" /></label><label htmlFor="absence-to" className="grid gap-2 text-xs font-medium">Bis<Input id="absence-to" required type="date" defaultValue="2026-10-18" className="h-11 rounded-sm" /></label></div>
              <label htmlFor="absence-reason" className="grid gap-2 text-xs font-medium">Grund (optional)<Textarea id="absence-reason" defaultValue="Familienurlaub" className="min-h-24 rounded-sm" /></label>
              <DialogFooter className="border-border bg-muted/30"><Button type="submit" className="h-11 rounded-sm bg-primary px-5 text-primary-foreground hover:bg-primary/85">Abwesenheit speichern</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={eventOpen} onOpenChange={setEventOpen}>
        <DialogContent className="border border-border bg-popover sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black uppercase tracking-tight">Neuen Termin anlegen</DialogTitle>
            <DialogDescription>Der Termin wird für die gewählte Gruppe eingetragen und automatisch angekündigt.</DialogDescription>
          </DialogHeader>
          <form action={createEvent} className="grid gap-4">
            <label htmlFor="event-title" className="grid gap-2 text-xs font-medium">Titel<Input id="event-title" name="title" required defaultValue="Leseprobe · Creepshow-Finale" className="h-11 rounded-sm" /></label>
            <div className="grid grid-cols-2 gap-3"><label htmlFor="event-date" className="grid gap-2 text-xs font-medium">Datum<Input id="event-date" name="date" required type="date" defaultValue="2026-09-27" className="h-11 rounded-sm" /></label><label htmlFor="event-time" className="grid gap-2 text-xs font-medium">Beginn<Input id="event-time" name="time" required type="time" defaultValue="15:00" className="h-11 rounded-sm" /></label></div>
            <label htmlFor="event-group" className="grid gap-2 text-xs font-medium">Sichtbar für<select id="event-group" name="group" defaultValue="Alle" className="h-11 rounded-sm border border-input bg-background px-3 text-sm outline-none focus:border-primary"><option>Alle</option><option>Jugendensemble</option><option>Erwachsenen-Ensemble</option><option>Technik</option><option>Kostümteam</option></select></label>
            <label htmlFor="event-note" className="grid gap-2 text-xs font-medium">Hinweis<Textarea id="event-note" placeholder="Was sollen die Mitglieder mitbringen?" className="min-h-20 rounded-sm" /></label>
            <div className="flex items-start gap-3 border border-border bg-background p-3"><BellRing className="mt-0.5 size-4 text-primary" /><p className="text-xs leading-relaxed text-muted-foreground">Alle Getaggten erhalten eine Erinnerung. Für diesen Sondertermin gilt die Absagefrist von 24 Stunden.</p></div>
            <DialogFooter className="border-border bg-muted/30"><Button type="submit" className="h-11 rounded-sm bg-primary px-5 text-primary-foreground hover:bg-primary/85"><Plus /> Termin veröffentlichen</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DashboardView({ attendance, notice, setResponse, events, openEvent, openAbsence, navigate, reminders, setReminders, downloadIcs }: {
  attendance: Attendance;
  notice: string;
  setResponse: (value: Attendance) => void;
  events: EventItem[];
  openEvent: (event: EventItem) => void;
  openAbsence: () => void;
  navigate: (view: View) => void;
  reminders: { dayBefore: boolean; twoHours: boolean; changes: boolean };
  setReminders: React.Dispatch<React.SetStateAction<{ dayBefore: boolean; twoHours: boolean; changes: boolean }>>;
  downloadIcs: (event: EventItem) => void;
}) {
  const next = events[0];
  return (
    <>
      <section className="mb-7 lg:hidden"><p className="font-mono text-[9px] uppercase tracking-[0.32em] text-primary">Deine Übersicht</p><h1 className="mt-2 text-2xl font-black uppercase tracking-tight">Hallo Logge.</h1></section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
        <section className="stage-card relative overflow-hidden border border-border bg-card p-5 shadow-2xl shadow-black/15 sm:p-7" aria-labelledby="next-rehearsal">
          <div className="absolute inset-x-0 top-0 h-1 bg-primary" />
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><span className="size-2 animate-pulse rounded-full bg-primary" /><p className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-primary">Nächste Probe · in 2 Tagen</p></div>
            <StatusPill>Creepshow-Ensemble</StatusPill>
          </div>
          <div className="grid gap-6 sm:grid-cols-[112px_1fr] sm:items-center">
            <div className="date-ticket flex h-28 w-full flex-col items-center justify-center border border-border bg-background sm:w-28"><span className="font-mono text-[10px] font-bold tracking-[0.28em] text-primary">DO · SEP</span><span className="mt-1 text-5xl font-black leading-none tracking-[-0.08em]">03</span></div>
            <div>
              <h2 id="next-rehearsal" className="text-3xl font-black leading-tight tracking-[-0.04em] sm:text-4xl">Wochenprobe<span className="mt-1 block text-primary">„Creepshow“</span></h2>
              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground"><span className="inline-flex items-center gap-2"><Clock3 className="size-4 text-primary" />19:00–21:00</span><span className="inline-flex items-center gap-2"><MapPin className="size-4 text-primary" />Großer Saal</span></div>
            </div>
          </div>
          <div className="mt-7 border-t border-border pt-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2"><div className={`grid size-7 place-items-center rounded-full ${attendance === 'yes' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>{attendance === 'yes' ? <Check className="size-4" /> : <X className="size-4" />}</div><p className="font-semibold">{attendance === 'yes' ? 'Du bist dabei' : 'Du bist abgemeldet'}</p></div>
                <p className="mt-2 max-w-md text-xs leading-relaxed text-muted-foreground" aria-live="polite">{notice}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <Button onClick={() => setResponse('yes')} className="h-11 rounded-sm bg-primary px-5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-primary-foreground hover:bg-primary/85"><Check /> Ich komme</Button>
                <Button onClick={() => setResponse('no')} variant="outline" className="h-11 rounded-sm border-border bg-transparent px-5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] hover:border-red-400 hover:bg-red-50 hover:text-red-700"><X /> Absagen</Button>
              </div>
            </div>
            <button type="button" onClick={() => openEvent(next)} className="mt-5 flex w-full items-center justify-between border-t border-border pt-4 text-left text-xs text-muted-foreground transition hover:text-primary"><span>24 Zusagen · Absage möglich bis Do., 17:00 Uhr</span><ChevronRight className="size-4" /></button>
          </div>
        </section>

        <section className="border border-border bg-card p-5 sm:p-6" aria-labelledby="attendance-title">
          <div className="flex items-start justify-between gap-4"><div><p className="font-mono text-[9px] uppercase tracking-[0.3em] text-primary">Deine Saison</p><h2 id="attendance-title" className="mt-2 text-lg font-black uppercase tracking-tight">Anwesenheit</h2></div><Sparkles className="size-5 text-primary" /></div>
          <div className="mt-7 flex items-end gap-3"><span className="text-5xl font-black tracking-[-0.08em]">92</span><span className="mb-1 text-lg font-bold text-primary">%</span><span className="mb-1 ml-auto text-xs text-emerald-700">+8% zum Vormonat</span></div>
          <div className="mt-4 h-2 overflow-hidden bg-muted"><div className="h-full w-[92%] bg-primary" /></div>
          <div className="mt-6 grid grid-cols-3 border-t border-border pt-5 text-center"><div><p className="text-xl font-black">11</p><p className="mt-1 text-[10px] text-muted-foreground">Teilnahmen</p></div><div className="border-x border-border"><p className="text-xl font-black">1</p><p className="mt-1 text-[10px] text-muted-foreground">Abgesagt</p></div><div><p className="text-xl font-black text-primary">5</p><p className="mt-1 text-[10px] text-muted-foreground">Serie</p></div></div>
          <div className="mt-5 flex items-center gap-3 border border-primary/20 bg-primary/5 p-3"><Trophy className="size-5 text-primary" /><p className="text-xs leading-relaxed text-muted-foreground">Noch eine Probe bis zu deiner persönlichen 6er‑Serie.</p></div>
        </section>
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section>
          <SectionHeading kicker="Für dich geplant" title="Deine nächsten Termine" action={<button type="button" onClick={() => navigate('calendar')} className="hidden items-center gap-2 font-mono text-[9px] uppercase tracking-[0.25em] text-muted-foreground transition hover:text-primary sm:flex">Alle Termine <ChevronRight className="size-3" /></button>} />
          <div className="grid gap-3 md:grid-cols-2">
            {events.slice(1, 5).map((event) => <EventRow key={event.id} event={event} onClick={() => openEvent(event)} />)}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="border border-border bg-card p-5">
            <div className="flex items-center justify-between"><div><p className="font-mono text-[9px] uppercase tracking-[0.25em] text-primary">Automatisch dran denken</p><h3 className="mt-2 font-black uppercase">Erinnerungen</h3></div><BellRing className="size-5 text-primary" /></div>
            <div className="mt-5 space-y-4">
              <ReminderRow label="24 Stunden vorher" checked={reminders.dayBefore} onChange={(checked) => setReminders((value) => ({ ...value, dayBefore: checked }))} />
              <ReminderRow label="2 Stunden vorher" checked={reminders.twoHours} onChange={(checked) => setReminders((value) => ({ ...value, twoHours: checked }))} />
              <ReminderRow label="Bei Terminänderungen" checked={reminders.changes} onChange={(checked) => setReminders((value) => ({ ...value, changes: checked }))} />
            </div>
          </section>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={openAbsence} className="border border-border bg-card p-4 text-left transition hover:border-primary"><CalendarCheck className="size-5 text-primary" /><p className="mt-3 text-sm font-bold">Abwesenheit</p><p className="mt-1 text-[10px] text-muted-foreground">Zeitraum melden</p></button>
            <button type="button" onClick={() => downloadIcs(next)} className="border border-border bg-card p-4 text-left transition hover:border-primary"><Download className="size-5 text-primary" /><p className="mt-3 text-sm font-bold">Kalender</p><p className="mt-1 text-[10px] text-muted-foreground">ICS exportieren</p></button>
          </div>
        </aside>
      </div>
    </>
  );
}

function EventRow({ event, onClick }: { event: EventItem; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex items-center gap-4 border border-border bg-card p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-xl hover:shadow-black/10">
      <div className="grid size-14 shrink-0 place-items-center border border-border bg-background"><div className="text-center"><p className="font-mono text-[8px] tracking-[0.2em] text-primary">{event.month}</p><p className="text-xl font-black leading-none">{String(event.day).padStart(2, '0')}</p></div></div>
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className={`size-1.5 rounded-full ${toneClasses[event.tone]}`} /><p className="truncate font-bold">{event.title}</p></div><p className="mt-1 text-xs text-muted-foreground">{event.weekday} · {event.time}</p><p className="mt-2 font-mono text-[8px] uppercase tracking-[0.2em] text-primary">{event.group} · {event.people} Personen</p></div>
      {event.locked ? <LockKeyhole className="size-4 text-amber-700" /> : <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" />}
    </button>
  );
}

function ReminderRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground"><span>{label}</span><button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`relative h-[18px] w-8 rounded-full transition ${checked ? 'bg-primary' : 'bg-input'}`}><span className={`absolute top-px size-4 rounded-full bg-background transition-transform ${checked ? 'translate-x-[15px]' : 'translate-x-px'}`} /></button></div>;
}

function CalendarView({ events, openEvent, openCreate }: { events: EventItem[]; openEvent: (event: EventItem) => void; openCreate: () => void }) {
  const [filter, setFilter] = useState('Alle');
  const days = [31, ...Array.from({ length: 30 }, (_, index) => index + 1), 1, 2, 3, 4];
  const filteredEvents = filter === 'Alle' ? events : events.filter((event) => event.group.includes(filter) || event.group === 'Alle');
  return (
    <>
      <SectionHeading kicker="Vereinskalender" title="September 2026" action={<Button onClick={openCreate} className="h-10 rounded-sm bg-primary px-4 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-primary-foreground hover:bg-primary/85"><Plus /> Termin anlegen</Button>} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {['Alle', 'Jugend', 'Ensemble', 'Technik'].map((item) => <button key={item} type="button" onClick={() => setFilter(item)} className={`rounded-full border px-4 py-2 text-xs transition ${filter === item ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/50'}`}>{item}</button>)}
        <div className="ml-auto hidden items-center gap-2 sm:flex"><Button aria-label="Vorheriger Monat" variant="outline" size="icon" className="rounded-sm"><ChevronLeft /></Button><Button aria-label="Nächster Monat" variant="outline" size="icon" className="rounded-sm"><ChevronRight /></Button></div>
      </div>

      <div className="overflow-x-auto border border-border bg-card">
        <div className="min-w-[840px]">
          <div className="grid grid-cols-7 border-b border-border bg-muted/40">{['MO', 'DI', 'MI', 'DO', 'FR', 'SA', 'SO'].map((day) => <div key={day} className="px-3 py-3 text-center font-mono text-[9px] font-bold tracking-[0.25em] text-muted-foreground">{day}</div>)}</div>
          <div className="grid grid-cols-7">
            {days.map((day, index) => {
              const outside = index === 0 || index > 30;
              const dayEvents = outside ? [] : filteredEvents.filter((event) => event.day === day);
              return (
                <div key={`${day}-${index}`} className={`min-h-28 border-b border-r border-border p-2 ${outside ? 'bg-background/50 text-muted-foreground/40' : 'bg-card'} ${day === 3 && !outside ? 'ring-1 ring-inset ring-primary/40' : ''}`}>
                  <div className="flex items-center justify-between"><span className={`grid size-7 place-items-center text-xs font-bold ${day === 1 && !outside ? 'rounded-full bg-primary text-primary-foreground' : ''}`}>{day}</span>{day === 3 && !outside && <span className="font-mono text-[7px] uppercase tracking-wider text-primary">Nächste Probe</span>}</div>
                  <div className="mt-2 space-y-1.5">
                    {dayEvents.map((event) => <button key={event.id} type="button" onClick={() => openEvent(event)} className="group w-full border border-border bg-background p-2 text-left transition hover:border-primary"><span className={`mb-1 block h-0.5 w-7 ${toneClasses[event.tone]}`} /><span className="line-clamp-2 text-[10px] font-bold leading-tight">{event.title}</span><span className="mt-1 block text-[8px] text-muted-foreground">{event.time.split('–')[0]} · {event.people} Zusagen</span></button>)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <div className="flex gap-3 border border-primary/20 bg-primary/5 p-4"><Clock3 className="mt-0.5 size-5 shrink-0 text-primary" /><div><p className="text-sm font-bold">Absagefristen</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Wochenproben bis 2 Stunden vorher, alle anderen Termine bis 24 Stunden vorher.</p></div></div>
        <div className="flex gap-3 border border-border bg-card p-4"><Users className="mt-0.5 size-5 shrink-0 text-primary" /><div><p className="text-sm font-bold">Sichtbarkeit nach Gruppe</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Mitglieder sehen nur persönliche, gruppenbezogene und allgemeine Termine.</p></div></div>
      </div>
    </>
  );
}

function PollsView({ choice, setChoice, confirmed, navigate }: { choice: string; setChoice: (value: string) => void; confirmed: boolean; navigate: (view: View) => void }) {
  return (
    <>
      <SectionHeading kicker="Gemeinsam planen" title="Terminabstimmungen" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <section className="border border-border bg-card p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><StatusPill tone={confirmed ? 'success' : 'warning'}>{confirmed ? 'Bestätigt' : 'Offen bis 10. September'}</StatusPill><h3 className="mt-5 text-2xl font-black uppercase tracking-tight">Zusatzprobe · Maskenball</h3><p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">Welche Zeit passt den 27 getaggten Mitgliedern am besten? Du kannst eine Option wählen.</p></div><Vote className="size-7 text-primary" /></div>
          <div className="mt-7 space-y-3">
            {pollOptions.map((option) => {
              const selected = choice === option.id;
              const percent = Math.round((option.votes / 39) * 100);
              return (
                <button key={option.id} type="button" aria-label={`${option.day}, ${option.time}, ${option.votes} Stimmen`} disabled={confirmed} onClick={() => setChoice(option.id)} className={`relative w-full overflow-hidden border p-4 text-left transition ${selected ? 'border-primary bg-primary/5' : 'border-border bg-background hover:border-primary/50'} disabled:cursor-default`}>
                  <span className="absolute inset-y-0 left-0 bg-primary/5" style={{ width: `${percent}%` }} />
                  <span className="relative flex items-center gap-4"><span className={`grid size-5 place-items-center rounded-full border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground'}`}>{selected && <Check className="size-3" />}</span><span className="flex-1"><span className="block text-sm font-bold">{option.day}</span><span className="mt-1 block text-xs text-muted-foreground">{option.time}</span></span><span className="text-right"><span className="block text-lg font-black">{option.votes}</span><span className="text-[9px] text-muted-foreground">Stimmen</span></span></span>
                </button>
              );
            })}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5"><div className="flex items-center gap-3"><MemberAvatars /><p className="text-xs text-muted-foreground">39 Stimmen<br />8 noch offen</p></div>{confirmed ? <StatusPill tone="success"><Check className="mr-1 size-3" /> Im Kalender</StatusPill> : <Button onClick={() => setChoice(choice)} className="h-10 rounded-sm bg-primary px-5 text-primary-foreground hover:bg-primary/85">Stimme speichern</Button>}</div>
        </section>

        <aside className="space-y-4">
          <div className="border border-border bg-card p-5"><Megaphone className="size-6 text-primary" /><h3 className="mt-4 font-black uppercase">So läuft es ab</h3><ol className="mt-4 space-y-4 text-xs leading-relaxed text-muted-foreground"><li className="flex gap-3"><span className="font-mono text-primary">01</span>Alle Getaggten stimmen für passende Zeiten.</li><li className="flex gap-3"><span className="font-mono text-primary">02</span>Die Probenleitung prüft das Ergebnis.</li><li className="flex gap-3"><span className="font-mono text-primary">03</span>Nach Bestätigung erscheint der Termin automatisch im Kalender.</li></ol></div>
          {!confirmed && <button type="button" onClick={() => navigate('admin')} className="flex w-full items-center gap-3 border border-primary/30 bg-primary/10 p-4 text-left transition hover:bg-primary/15"><ShieldCheck className="size-5 text-primary" /><span><span className="block text-sm font-bold">Admin‑Vorschau öffnen</span><span className="mt-1 block text-[10px] text-muted-foreground">Ergebnis bestätigen</span></span><ChevronRight className="ml-auto size-4 text-primary" /></button>}
        </aside>
      </div>
    </>
  );
}

function StatsView() {
  return (
    <>
      <SectionHeading kicker="Motivation sichtbar machen" title="Anwesenheit & Entwicklung" />
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Verein gesamt" value="86%" hint="+5% seit April" icon={Users} />
        <MetricCard label="Deine Anwesenheit" value="92%" hint="Persönliche Bestmarke" icon={UserCheck} accent />
        <MetricCard label="Aktive Serie" value="5×" hint="Proben in Folge" icon={Trophy} />
        <MetricCard label="Früh abgesagt" value="94%" hint="Planbar für die Leitung" icon={CalendarCheck} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
        <section className="border border-border bg-card p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-[9px] uppercase tracking-[0.28em] text-primary">Letzte 6 Monate</p><h3 className="mt-2 text-lg font-black uppercase">Vereinsweite Teilnahme</h3></div><StatusPill>Ziel · 85%</StatusPill></div>
          <ChartContainer config={chartConfig} className="mt-7 h-[280px] w-full aspect-auto">
            <RechartsBarChart data={chartData} accessibilityLayer barGap={4}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={10} />
              <ChartTooltip cursor={{ fill: 'rgba(255,121,0,.06)' }} content={<ChartTooltipContent />} />
              <Bar dataKey="target" fill="var(--color-target)" radius={[2, 2, 0, 0]} />
              <Bar dataKey="attendance" fill="var(--color-attendance)" radius={[2, 2, 0, 0]} />
            </RechartsBarChart>
          </ChartContainer>
        </section>
        <section className="border border-border bg-card p-5 sm:p-7"><p className="font-mono text-[9px] uppercase tracking-[0.28em] text-primary">Nach Gruppen</p><h3 className="mt-2 text-lg font-black uppercase">Aktueller Monat</h3><div className="mt-7 space-y-6"><GroupBar label="Jugendensemble" value={94} people="18 Mitglieder" /><GroupBar label="Erwachsenen-Ensemble" value={87} people="21 Mitglieder" /><GroupBar label="Technik" value={82} people="9 Mitglieder" /><GroupBar label="Kostümteam" value={78} people="7 Mitglieder" /></div></section>
      </div>

      <div className="mt-6 flex gap-3 border border-border bg-card p-4"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" /><div><p className="text-sm font-bold">Fair und kindgerecht</p><p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">Die persönliche Entwicklung ist nur für das Mitglied und die zuständige Leitung sichtbar. Es gibt keine öffentliche Rangliste – Motivation entsteht durch Ziele und Verlässlichkeit, nicht durch Bloßstellung.</p></div></div>
    </>
  );
}

function MetricCard({ label, value, hint, icon: Icon, accent = false }: { label: string; value: string; hint: string; icon: typeof Users; accent?: boolean }) {
  return <div className={`border p-5 ${accent ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`}><div className="flex items-start justify-between"><p className={`font-mono text-[9px] uppercase tracking-[0.22em] ${accent ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{label}</p><Icon className="size-5" /></div><p className="mt-7 text-4xl font-black tracking-[-0.06em]">{value}</p><p className={`mt-1 text-xs ${accent ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{hint}</p></div>;
}

function GroupBar({ label, value, people }: { label: string; value: number; people: string }) {
  return <div><div className="mb-2 flex items-end justify-between gap-3"><div><p className="text-sm font-bold">{label}</p><p className="mt-1 text-[10px] text-muted-foreground">{people}</p></div><span className="font-mono text-sm font-bold text-primary">{value}%</span></div><div className="h-1.5 bg-muted"><div className="h-full bg-primary" style={{ width: `${value}%` }} /></div></div>;
}

function AdminView({ notice, pollConfirmed, confirmPoll, openCreate, navigate, customEvent }: { notice: string; pollConfirmed: boolean; confirmPoll: () => void; openCreate: () => void; navigate: (view: View) => void; customEvent: EventItem | null }) {
  return (
    <>
      <SectionHeading kicker="Organisation" title="Adminbereich" action={<Button onClick={openCreate} className="h-10 rounded-sm bg-primary px-4 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-primary-foreground hover:bg-primary/85"><Plus /> Termin anlegen</Button>} />
      {notice && <div className="mb-6 flex items-start gap-3 border border-emerald-600/25 bg-emerald-50 p-4 text-sm text-emerald-700" aria-live="polite"><Check className="mt-0.5 size-5 shrink-0" /><span>{notice}</span></div>}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Mitglieder" value="55" hint="37 Erwachsene · 18 Kinder" icon={Users} /><MetricCard label="Probe Donnerstag" value="24" hint="6 Rückmeldungen offen" icon={CalendarCheck} accent /><MetricCard label="Abwesenheiten" value="3" hint="Für September gemeldet" icon={Clock3} /><MetricCard label="Erinnerungen" value="96%" hint="Erfolgreich zugestellt" icon={BellRing} /></div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="border border-border bg-card p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-[9px] uppercase tracking-[0.28em] text-primary">Entscheidung nötig</p><h3 className="mt-2 text-lg font-black uppercase">Terminabstimmung</h3></div><Vote className="size-5 text-primary" /></div><div className="mt-6 border border-border bg-background p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-bold">Zusatzprobe · Maskenball</p><p className="mt-1 text-xs text-muted-foreground">39 Stimmen · klare Mehrheit</p></div><StatusPill tone={pollConfirmed ? 'success' : 'warning'}>{pollConfirmed ? 'Bestätigt' : 'Offen'}</StatusPill></div><div className="mt-4 flex items-center gap-3 border-l-2 border-primary pl-4"><div className="flex-1"><p className="font-mono text-[9px] uppercase tracking-wider text-primary">Gewinner · 19 Stimmen</p><p className="mt-1 text-sm font-bold">Samstag, 19. September · 14:00</p></div></div></div>{pollConfirmed ? <div className="mt-4 flex items-center gap-2 text-sm text-emerald-700"><Check className="size-4" />Im Kalender veröffentlicht</div> : <Button onClick={confirmPoll} className="mt-4 h-10 w-full rounded-sm bg-primary text-primary-foreground hover:bg-primary/85"><Check /> Termin bestätigen & eintragen</Button>}</section>

        <section className="border border-border bg-card p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-[9px] uppercase tracking-[0.28em] text-primary">Donnerstag · 03. September</p><h3 className="mt-2 text-lg font-black uppercase">Probenanwesenheit</h3></div><ClipboardCheck className="size-5 text-primary" /></div><div className="mt-6 grid grid-cols-3 gap-3 text-center"><div className="border border-border bg-background p-3"><p className="text-2xl font-black">24</p><p className="text-[9px] text-muted-foreground">Zugesagt</p></div><div className="border border-border bg-background p-3"><p className="text-2xl font-black">5</p><p className="text-[9px] text-muted-foreground">Abgesagt</p></div><div className="border border-amber-500/30 bg-amber-50 p-3"><p className="text-2xl font-black text-amber-700">6</p><p className="text-[9px] text-muted-foreground">Offen</p></div></div><Button onClick={() => navigate('checkin')} variant="outline" className="mt-4 h-10 w-full rounded-sm border-border bg-transparent hover:border-primary"><ClipboardCheck /> Anwesenheit abhaken</Button></section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]"><section className="border border-border bg-card"><div className="flex items-center justify-between border-b border-border p-5"><div><p className="font-mono text-[9px] uppercase tracking-[0.28em] text-primary">Mitglieder & Gruppen</p><h3 className="mt-2 font-black uppercase">Offene Rückmeldungen</h3></div><Button variant="outline" size="sm" className="rounded-sm">Alle anzeigen</Button></div><div className="divide-y divide-border">{memberSeed.slice(2, 6).map((member, index) => <div key={member.id} className="flex items-center gap-3 p-4"><div className="grid size-9 place-items-center rounded-full bg-muted text-[10px] font-bold">{member.initials}</div><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{member.name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{member.group}</p></div><StatusPill tone={index === 0 ? 'warning' : 'neutral'}>{index === 0 ? 'Nicht reagiert' : 'Automatisch dabei'}</StatusPill></div>)}</div></section><section className="border border-border bg-card p-5"><Settings2 className="size-5 text-primary" /><h3 className="mt-4 font-black uppercase">Automationen</h3><div className="mt-5 space-y-4"><ReminderRow label="Wöchentliche Probe" checked onChange={() => {}} /><ReminderRow label="Erinnerung bei Nichtreaktion" checked onChange={() => {}} /><ReminderRow label="Elternkontakt bei Kindern" checked onChange={() => {}} /></div><p className="mt-5 border-t border-border pt-4 text-[10px] leading-relaxed text-muted-foreground">Erinnerungen gehen nur an Mitglieder, Erziehungsberechtigte oder Gruppen, die für den Termin getaggt sind.</p>{customEvent && <div className="mt-4 border border-primary/20 bg-primary/5 p-3 text-xs text-primary">Neu: {customEvent.title}</div>}</section></div>
    </>
  );
}

function CheckinView({ members, setMembers, saved, setSaved, presentCount, navigate }: { members: typeof memberSeed; setMembers: React.Dispatch<React.SetStateAction<typeof memberSeed>>; saved: boolean; setSaved: (value: boolean) => void; presentCount: number; navigate: (view: View) => void }) {
  const toggleMember = (id: number, checked: boolean) => { setSaved(false); setMembers((list) => list.map((member) => member.id === id ? { ...member, present: checked } : member)); };
  return (
    <>
      <div className="mb-6 flex items-center gap-4"><button type="button" aria-label="Zurück zum Adminbereich" onClick={() => navigate('admin')} className="grid size-10 place-items-center border border-border bg-card text-muted-foreground hover:border-primary hover:text-primary"><ArrowLeft className="size-4" /></button><div><p className="font-mono text-[9px] uppercase tracking-[0.28em] text-primary">Probenleitung · Live</p><h2 className="mt-1 text-2xl font-black uppercase tracking-tight">Anwesenheit abhaken</h2></div></div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <section className="border border-border bg-card"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5"><div><p className="font-bold">Wochenprobe „Creepshow“</p><p className="mt-1 text-xs text-muted-foreground">Donnerstag, 03. September · 19:00</p></div><StatusPill tone="success"><span className="mr-2 size-1.5 animate-pulse rounded-full bg-emerald-500" /> Probe läuft</StatusPill></div><div className="divide-y divide-border">{members.map((member) => <label key={member.id} className="flex cursor-pointer items-center gap-4 p-4 transition hover:bg-muted/40"><input type="checkbox" checked={member.present} onChange={(event) => toggleMember(member.id, event.target.checked)} className="size-5 accent-[#c94f1d]" /><div className="grid size-10 place-items-center rounded-full bg-muted text-[10px] font-bold">{member.initials}</div><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{member.name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{member.group}</p></div><span className={`text-xs font-medium ${member.present ? 'text-emerald-700' : 'text-muted-foreground'}`}>{member.present ? 'Anwesend' : 'Fehlt'}</span></label>)}</div></section>
        <aside className="space-y-4"><section className="border border-primary bg-primary p-6 text-primary-foreground"><p className="font-mono text-[9px] uppercase tracking-[0.25em] text-primary-foreground/70">Aktueller Stand</p><div className="mt-5 flex items-end gap-2"><span className="text-6xl font-black tracking-[-0.08em]">{presentCount}</span><span className="mb-2 text-lg font-bold">/ {members.length}</span></div><p className="mt-2 text-sm text-primary-foreground/70">tatsächlich anwesend</p><div className="mt-5 h-2 bg-white/20"><div className="h-full bg-white" style={{ width: `${(presentCount / members.length) * 100}%` }} /></div></section><div className="border border-border bg-card p-5"><p className="text-sm font-bold">Nach der Probe</p><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Gespeicherte Anwesenheit fließt in die persönliche und vereinsweite Statistik ein.</p><Button onClick={() => setSaved(true)} className="mt-5 h-11 w-full rounded-sm bg-primary text-primary-foreground hover:bg-primary/85"><Check /> Anwesenheit speichern</Button>{saved && <p className="mt-3 text-center text-xs text-emerald-700" aria-live="polite">Gespeichert · 20:54 Uhr</p>}</div><button type="button" onClick={() => { setMembers(memberSeed); setSaved(false); }} className="flex w-full items-center justify-center gap-2 p-3 text-xs text-muted-foreground hover:text-primary"><RotateCcw className="size-3" /> Beispielzustand zurücksetzen</button></aside>
      </div>
    </>
  );
}

function EventDialog({ event, onClose, attendance, setResponse, downloadIcs, openGoogleCalendar }: { event: EventItem | null; onClose: () => void; attendance: Attendance; setResponse: (value: Attendance) => void; downloadIcs: (event: EventItem) => void; openGoogleCalendar: (event: EventItem) => void }) {
  if (!event) return null;
  return (
    <Dialog open={Boolean(event)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="border border-border bg-popover p-0 sm:max-w-xl">
        <div className={`h-1 ${toneClasses[event.tone]}`} />
        <div className="p-5 sm:p-6"><DialogHeader><div className="mb-2 flex flex-wrap gap-2"><StatusPill>{event.group}</StatusPill>{event.locked && <StatusPill tone="warning"><LockKeyhole className="mr-1 size-3" /> Frist abgelaufen</StatusPill>}</div><DialogTitle className="pr-8 text-2xl font-black uppercase leading-tight tracking-[-0.03em]">{event.title}</DialogTitle><DialogDescription>{event.weekday}, {String(event.day).padStart(2, '0')}. September 2026</DialogDescription></DialogHeader>
          <div className="mt-6 grid gap-3 sm:grid-cols-2"><div className="flex gap-3 border border-border bg-background p-3"><Clock3 className="mt-0.5 size-4 text-primary" /><div><p className="text-xs font-bold">{event.time}</p><p className="mt-1 text-[10px] text-muted-foreground">{event.type === 'weekly' ? 'Absage bis 2h vorher' : 'Absage bis 24h vorher'}</p></div></div><div className="flex gap-3 border border-border bg-background p-3"><MapPin className="mt-0.5 size-4 text-primary" /><div><p className="text-xs font-bold">{event.place}</p><p className="mt-1 text-[10px] text-muted-foreground">Ramsen</p></div></div></div>
          <div className="mt-5 border border-border bg-background p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold">{event.people} Personen sind dabei</p><p className="mt-1 text-[10px] text-muted-foreground">6 Rückmeldungen noch offen</p></div><MemberAvatars /></div><div className="mt-4 flex flex-wrap gap-2">{memberSeed.slice(0, 5).map((member) => <span key={member.id} className="rounded-full bg-muted px-2.5 py-1 text-[9px] text-muted-foreground">{member.name}</span>)}<span className="rounded-full bg-muted px-2.5 py-1 text-[9px] text-muted-foreground">+{Math.max(event.people - 5, 0)}</span></div></div>
          <div className="mt-5"><p className="mb-2 font-mono text-[9px] uppercase tracking-[0.24em] text-muted-foreground">Deine Teilnahme</p><div className="grid grid-cols-2 gap-2"><Button disabled={event.locked} onClick={() => setResponse('yes')} className={`h-11 rounded-sm ${attendance === 'yes' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'} hover:bg-primary/85`}><Check /> Ich komme</Button><Button disabled={event.locked} onClick={() => setResponse('no')} variant="outline" className="h-11 rounded-sm border-border bg-transparent hover:border-red-400 hover:bg-red-50"><X /> Absagen</Button></div>{event.locked && <p className="mt-2 flex items-center gap-2 text-[10px] text-amber-700"><CircleAlert className="size-3" />Die Absagefrist ist vorbei. Bitte kontaktiere die Probenleitung.</p>}</div>
          <div className="mt-5 border-t border-border pt-5"><p className="mb-3 font-mono text-[9px] uppercase tracking-[0.24em] text-muted-foreground">In Kalender‑App übernehmen</p><div className="grid gap-2 sm:grid-cols-2"><Button onClick={() => downloadIcs(event)} variant="outline" className="h-10 rounded-sm border-border bg-transparent"><Download /> Apple / Outlook (.ics)</Button><Button onClick={() => openGoogleCalendar(event)} variant="outline" className="h-10 rounded-sm border-border bg-transparent">Google Kalender <ExternalLink /></Button></div></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
