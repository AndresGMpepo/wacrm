'use client';

import { useMemo } from 'react';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { colorForStatus } from '@/lib/agendapro/status-colors';

export type CalendarBooking = {
  id: number;
  start: string;
  end: string;
  service: string;
  status: string;
  client: { first_name: string; last_name: string | null } | null;
};

const WEEKDAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
/** Cells are small — more than this and the day just shows "+N más". */
const MAX_CHIPS_PER_DAY = 3;

function clientLabel(client: CalendarBooking['client']) {
  if (!client) return 'Sin cliente';
  return `${client.first_name} ${client.last_name ?? ''}`.trim();
}

/**
 * Month-grid calendar for AgendaPro bookings — the visual, color-coded
 * view requested to match AgendaPro's own look, instead of a flat list.
 * Colors come from colorForStatus (deterministic default + account
 * override, see status-colors.ts) since AgendaPro's status taxonomy
 * isn't a documented fixed set.
 */
export function AgendaProMonthCalendar({
  month,
  onMonthChange,
  bookings,
  statusColors,
  selectedDate,
  onSelectDate,
}: {
  month: Date;
  onMonthChange: (next: Date) => void;
  bookings: CalendarBooking[];
  statusColors: Record<string, string>;
  selectedDate: string;
  onSelectDate: (iso: string) => void;
}) {
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });

  const days = useMemo(() => {
    const result: Date[] = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) result.push(d);
    return result;
  }, [gridStart, gridEnd]);

  const bookingsByDay = useMemo(() => {
    const map = new Map<string, CalendarBooking[]>();
    for (const booking of bookings) {
      const key = booking.start.slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(booking);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.start.localeCompare(b.start));
    return map;
  }, [bookings]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold capitalize text-foreground">
          {format(month, 'MMMM yyyy', { locale: es })}
        </h2>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" onClick={() => onMonthChange(subMonths(month, 1))} aria-label="Mes anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => onMonthChange(new Date())}>
            Hoy
          </Button>
          <Button variant="outline" size="icon" onClick={() => onMonthChange(addMonths(month, 1))} aria-label="Mes siguiente">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border text-xs">
        {WEEKDAY_LABELS.map((label, index) => (
          <div key={`${label}-${index}`} className="bg-muted/60 px-2 py-1.5 text-center font-medium text-muted-foreground">
            {label}
          </div>
        ))}
        {days.map((day) => {
          const iso = format(day, 'yyyy-MM-dd');
          const dayBookings = bookingsByDay.get(iso) ?? [];
          const overflow = dayBookings.length - MAX_CHIPS_PER_DAY;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelectDate(iso)}
              className={`min-h-[6rem] space-y-1 bg-background p-1.5 text-left align-top transition-colors hover:bg-muted/40 ${
                isSameMonth(day, month) ? '' : 'opacity-40'
              } ${selectedDate === iso ? 'ring-2 ring-inset ring-primary' : ''}`}
            >
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                  isToday(day) ? 'bg-primary font-semibold text-primary-foreground' : 'text-foreground'
                }`}
              >
                {format(day, 'd')}
              </span>
              <div className="space-y-0.5">
                {dayBookings.slice(0, MAX_CHIPS_PER_DAY).map((booking) => (
                  <div
                    key={booking.id}
                    className="truncate rounded px-1 py-0.5 text-[10px] font-medium text-white"
                    style={{ backgroundColor: colorForStatus(booking.status, statusColors) }}
                    title={`${format(new Date(booking.start), 'HH:mm')} · ${clientLabel(booking.client)} · ${booking.service}`}
                  >
                    {format(new Date(booking.start), 'HH:mm')} {clientLabel(booking.client)}
                  </div>
                ))}
                {overflow > 0 ? (
                  <div className="px-1 text-[10px] text-muted-foreground">+{overflow} más</div>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function isSameCalendarDay(isoA: string, isoB: string) {
  return isSameDay(new Date(isoA), new Date(isoB));
}
