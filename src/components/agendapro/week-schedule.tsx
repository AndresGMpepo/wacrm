'use client';

import { useMemo } from 'react';
import { addDays, format, isToday } from 'date-fns';
import { es } from 'date-fns/locale';

import { colorForStatus } from '@/lib/agendapro/status-colors';
import { parseAgendaProTime } from '@/lib/agendapro/time';
import {
  DEFAULT_END_HOUR,
  DEFAULT_START_HOUR,
  PX_PER_MINUTE,
  clickedMinutes,
  clientLabel,
  layoutOverlaps,
  minutesSinceMidnight,
  type LaidOutBooking,
  type ScheduleBooking,
} from '@/components/agendapro/day-schedule';

export type WeekBooking = ScheduleBooking & { service_provider: string };

/**
 * Week view (Monday–Sunday): one column per day with every booking of the
 * (already filtered) providers placed at its real time — the AgendaPro-style
 * week grid. Overlapping bookings on the same day sit side by side, using
 * the same packing as the day view, and each block shows its provider since
 * all providers share a column here. Clicking an empty spot calls
 * onEmptySlotClick with that day and the time under the pointer.
 */
export function AgendaProWeekSchedule({
  weekStart,
  bookings,
  statusColors,
  onSelectBooking,
  onEmptySlotClick,
  onSelectDay,
  selectedBookingId,
}: {
  weekStart: Date;
  bookings: WeekBooking[];
  statusColors: Record<string, string>;
  onSelectBooking: (booking: WeekBooking, element: HTMLElement) => void;
  onEmptySlotClick?: (dateISO: string, minutes: number) => void;
  onSelectDay?: (dateISO: string) => void;
  selectedBookingId: number | null;
}) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const { startHour, endHour } = useMemo(() => {
    let minMinute = DEFAULT_START_HOUR * 60;
    let maxMinute = DEFAULT_END_HOUR * 60;
    for (const booking of bookings) {
      minMinute = Math.min(minMinute, minutesSinceMidnight(booking.start));
      maxMinute = Math.max(maxMinute, minutesSinceMidnight(booking.end));
    }
    return { startHour: Math.floor(minMinute / 60), endHour: Math.ceil(maxMinute / 60) };
  }, [bookings]);

  const gridHeight = (endHour - startHour) * 60 * PX_PER_MINUTE;
  const hours = useMemo(() => {
    const result: number[] = [];
    for (let h = startHour; h <= endHour; h++) result.push(h);
    return result;
  }, [startHour, endHour]);

  // Keyed by the booking's own wall-clock date — the same date the rest
  // of the calendar uses (`start.slice(0, 10)`).
  const bookingsByDay = useMemo(() => {
    const grouped = new Map<string, WeekBooking[]>();
    for (const booking of bookings) {
      const key = booking.start.slice(0, 10);
      const list = grouped.get(key) ?? [];
      list.push(booking);
      grouped.set(key, list);
    }
    const laidOut = new Map<string, LaidOutBooking<WeekBooking>[]>();
    for (const [key, list] of grouped) laidOut.set(key, layoutOverlaps(list));
    return laidOut;
  }, [bookings]);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <div className="flex min-w-max">
        <div className="w-16 shrink-0 border-r bg-muted/30">
          <div className="h-12 border-b" />
          <div style={{ height: gridHeight }} className="relative">
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 w-full -translate-y-1/2 pr-2 text-right text-[11px] text-muted-foreground"
                style={{ top: (hour - startHour) * 60 * PX_PER_MINUTE }}
              >
                {String(hour).padStart(2, '0')}:00
              </div>
            ))}
          </div>
        </div>

        {days.map((day) => {
          const dateISO = format(day, 'yyyy-MM-dd');
          const dayBookings = bookingsByDay.get(dateISO) ?? [];
          return (
            <div key={dateISO} className="w-40 shrink-0 border-r last:border-r-0">
              <button
                type="button"
                onClick={onSelectDay ? () => onSelectDay(dateISO) : undefined}
                className={`flex h-12 w-full flex-col items-center justify-center border-b px-2 text-center ${
                  isToday(day) ? 'bg-primary/10' : 'bg-muted/30'
                } ${onSelectDay ? 'hover:bg-muted' : ''}`}
                title={onSelectDay ? 'Ver este día' : undefined}
              >
                <span className="text-[11px] capitalize text-muted-foreground">{format(day, 'EEEE', { locale: es })}</span>
                <span className={`text-sm font-semibold ${isToday(day) ? 'text-primary' : 'text-foreground'}`}>
                  {format(day, 'd MMM', { locale: es })}
                  {dayBookings.length ? <span className="ml-1 text-[10px] font-normal text-muted-foreground">({dayBookings.length})</span> : null}
                </span>
              </button>
              <div
                className={`relative ${onEmptySlotClick ? 'cursor-cell' : ''}`}
                style={{ height: gridHeight }}
                onClick={onEmptySlotClick ? (event) => onEmptySlotClick(dateISO, clickedMinutes(event, startHour)) : undefined}
                title={onEmptySlotClick ? 'Clic en un espacio libre para crear una reserva' : undefined}
              >
                {hours.map((hour) => (
                  <div
                    key={hour}
                    className="absolute w-full border-t border-dashed border-border/60"
                    style={{ top: (hour - startHour) * 60 * PX_PER_MINUTE }}
                  />
                ))}
                {dayBookings.map((booking) => {
                  const top = (minutesSinceMidnight(booking.start) - startHour * 60) * PX_PER_MINUTE;
                  const height = Math.max(20, (minutesSinceMidnight(booking.end) - minutesSinceMidnight(booking.start)) * PX_PER_MINUTE);
                  const widthPct = 100 / booking.totalCols;
                  return (
                    <button
                      key={booking.id}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectBooking(booking, event.currentTarget);
                      }}
                      title={`${clientLabel(booking.client)} · ${booking.service} · ${booking.service_provider}`}
                      className={`absolute overflow-hidden rounded px-1 py-0.5 text-left text-[10px] leading-tight text-white shadow-sm transition-transform hover:z-10 hover:scale-[1.02] ${
                        selectedBookingId === booking.id ? 'ring-2 ring-foreground' : ''
                      }`}
                      style={{
                        top,
                        height,
                        left: `calc(${booking.col * widthPct}% + 1px)`,
                        width: `calc(${widthPct}% - 2px)`,
                        backgroundColor: colorForStatus(booking.status, statusColors),
                      }}
                    >
                      <div className="truncate font-semibold">{clientLabel(booking.client)}</div>
                      <div className="truncate opacity-90">
                        {format(parseAgendaProTime(booking.start), 'HH:mm')} · {booking.service_provider}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
