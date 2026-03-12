'use client';

import { useState, useEffect } from 'react';
import { Calendar, Clock, MapPin, Check } from 'lucide-react';
import { createAppointment, getAvailableSlots } from '@/lib/actions/appointment-actions';

interface BookingFormProps {
  office: any;
  organization: any;
  departments: any[];
}

type Step = 'department' | 'service' | 'date' | 'time' | 'info' | 'confirm' | 'done';

export function BookingForm({ office, organization, departments }: BookingFormProps) {
  const [step, setStep] = useState<Step>('department');
  const [selectedDept, setSelectedDept] = useState<any>(null);
  const [selectedService, setSelectedService] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appointment, setAppointment] = useState<any>(null);

  const today = new Date().toISOString().split('T')[0];

  // Fetch available slots when date changes
  useEffect(() => {
    if (!selectedDate || !selectedService) return;
    setLoadingSlots(true);
    setSelectedTime('');
    getAvailableSlots(office.id, selectedService.id, selectedDate).then((result) => {
      if (result.error) {
        setError(result.error);
        setAvailableSlots([]);
      } else {
        setAvailableSlots(result.data ?? []);
      }
      setLoadingSlots(false);
    });
  }, [selectedDate, selectedService, office.id]);

  function handleSelectDepartment(dept: any) {
    setSelectedDept(dept);
    setSelectedService(null);
    setSelectedDate('');
    setSelectedTime('');
    setStep('service');
  }

  function handleSelectService(service: any) {
    setSelectedService(service);
    setSelectedDate('');
    setSelectedTime('');
    setStep('date');
  }

  function handleSelectDate() {
    if (!selectedDate) return;
    setStep('time');
  }

  function handleSelectTime(time: string) {
    setSelectedTime(time);
    setStep('info');
  }

  function handleCustomerInfo() {
    if (!customerName.trim()) {
      setError('Please enter your name');
      return;
    }
    setError(null);
    setStep('confirm');
  }

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);

    const scheduledAt = `${selectedDate}T${selectedTime}:00`;

    const result = await createAppointment({
      officeId: office.id,
      departmentId: selectedDept.id,
      serviceId: selectedService.id,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || undefined,
      customerEmail: customerEmail.trim() || undefined,
      scheduledAt,
    });

    if (result.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    setAppointment(result.data);
    setStep('done');
    setSubmitting(false);
  }

  function handleBack() {
    setError(null);
    switch (step) {
      case 'service':
        setStep('department');
        break;
      case 'date':
        setStep('service');
        break;
      case 'time':
        setStep('date');
        break;
      case 'info':
        setStep('time');
        break;
      case 'confirm':
        setStep('info');
        break;
    }
  }

  function handleStartOver() {
    setStep('department');
    setSelectedDept(null);
    setSelectedService(null);
    setSelectedDate('');
    setSelectedTime('');
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setAppointment(null);
    setError(null);
  }

  const stepNumber = {
    department: 1,
    service: 2,
    date: 3,
    time: 4,
    info: 5,
    confirm: 6,
    done: 7,
  }[step];

  function formatTime(time: string) {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10">
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-4 text-center">
        <h1 className="text-2xl font-bold text-foreground">
          {organization?.name || 'QueueFlow'}
        </h1>
        <div className="mt-1 flex items-center justify-center gap-1.5 text-muted-foreground">
          <MapPin className="h-4 w-4" />
          <span>{office.name}</span>
        </div>
        <p className="mt-1 text-sm font-medium text-primary">Book an Appointment</p>
      </div>

      {/* Progress bar */}
      {step !== 'done' && (
        <div className="mx-auto max-w-2xl px-4 pt-6">
          <div className="mb-2 flex items-center gap-2">
            {[1, 2, 3, 4, 5, 6].map((s) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  s <= stepNumber ? 'bg-primary' : 'bg-muted'
                }`}
              />
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Step {stepNumber} of 6
          </p>
        </div>
      )}

      <div className="mx-auto max-w-2xl px-4 py-6">
        {error && (
          <div className="mb-4 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Step 1: Select Department */}
        {step === 'department' && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-foreground">Select Department</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                Choose the department for your appointment
              </p>
            </div>
            <div className="grid gap-4">
              {departments.map((dept) => (
                <button
                  key={dept.id}
                  onClick={() => handleSelectDepartment(dept)}
                  className="flex items-center justify-between rounded-xl border border-border bg-card p-6 text-left shadow-sm transition-all hover:border-primary hover:shadow-md"
                >
                  <div>
                    <h3 className="text-xl font-semibold text-foreground">{dept.name}</h3>
                    {dept.description && (
                      <p className="mt-1 text-muted-foreground">{dept.description}</p>
                    )}
                  </div>
                  <div className="text-2xl font-bold text-primary">{dept.code}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Select Service */}
        {step === 'service' && selectedDept && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-foreground">{selectedDept.name}</h2>
              <p className="mt-2 text-lg text-muted-foreground">Select a service</p>
            </div>
            <div className="grid gap-4">
              {selectedDept.services
                ?.filter((s: any) => s.is_active)
                ?.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
                .map((service: any) => (
                  <button
                    key={service.id}
                    onClick={() => handleSelectService(service)}
                    className="flex items-center justify-between rounded-xl border border-border bg-card p-6 text-left shadow-sm transition-all hover:border-primary hover:shadow-md"
                  >
                    <div>
                      <h3 className="text-xl font-semibold text-foreground">{service.name}</h3>
                      {service.description && (
                        <p className="mt-1 text-muted-foreground">{service.description}</p>
                      )}
                      {service.estimated_service_time && (
                        <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          <span>Est. {service.estimated_service_time} min</span>
                        </div>
                      )}
                    </div>
                    <div className="text-lg font-bold text-primary">{service.code}</div>
                  </button>
                ))}
            </div>
            <button
              onClick={handleBack}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Back to Departments
            </button>
          </div>
        )}

        {/* Step 3: Select Date */}
        {step === 'date' && (
          <div className="space-y-6">
            <div className="text-center">
              <Calendar className="mx-auto h-10 w-10 text-primary" />
              <h2 className="mt-3 text-3xl font-bold text-foreground">Choose a Date</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                Select when you would like to visit
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <input
                type="date"
                min={today}
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-lg text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              {selectedDate && (
                <p className="mt-3 text-center text-muted-foreground">
                  {formatDate(selectedDate)}
                </p>
              )}
            </div>
            <button
              onClick={handleSelectDate}
              disabled={!selectedDate}
              className="w-full rounded-xl bg-primary px-4 py-4 text-lg font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
            <button
              onClick={handleBack}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Back
            </button>
          </div>
        )}

        {/* Step 4: Select Time */}
        {step === 'time' && (
          <div className="space-y-6">
            <div className="text-center">
              <Clock className="mx-auto h-10 w-10 text-primary" />
              <h2 className="mt-3 text-3xl font-bold text-foreground">Choose a Time</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                {formatDate(selectedDate)}
              </p>
            </div>

            {loadingSlots ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : availableSlots.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-6 text-center shadow-sm">
                <p className="text-lg text-muted-foreground">
                  No available time slots for this date.
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Please choose a different date.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {availableSlots.map((slot) => (
                  <button
                    key={slot}
                    onClick={() => handleSelectTime(slot)}
                    className={`rounded-xl border p-3 text-center font-medium transition-all ${
                      selectedTime === slot
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card text-foreground hover:border-primary hover:shadow-sm'
                    }`}
                  >
                    {formatTime(slot)}
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={handleBack}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Back
            </button>
          </div>
        )}

        {/* Step 5: Customer Info */}
        {step === 'info' && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-foreground">Your Information</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                Please provide your details
              </p>
            </div>

            <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Full Name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter your full name"
                  className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Phone Number <span className="text-xs text-muted-foreground">(optional)</span>
                </label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="Enter your phone number"
                  className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Email <span className="text-xs text-muted-foreground">(optional)</span>
                </label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="Enter your email address"
                  className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            <button
              onClick={handleCustomerInfo}
              className="w-full rounded-xl bg-primary px-4 py-4 text-lg font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              Review Appointment
            </button>
            <button
              onClick={handleBack}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Back
            </button>
          </div>
        )}

        {/* Step 6: Confirmation */}
        {step === 'confirm' && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-foreground">Confirm Appointment</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                Please review your appointment details
              </p>
            </div>

            <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
              <div className="flex justify-between border-b border-border py-2">
                <span className="text-muted-foreground">Department</span>
                <span className="font-medium text-foreground">{selectedDept?.name}</span>
              </div>
              <div className="flex justify-between border-b border-border py-2">
                <span className="text-muted-foreground">Service</span>
                <span className="font-medium text-foreground">{selectedService?.name}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border py-2">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  Date
                </span>
                <span className="font-medium text-foreground">{formatDate(selectedDate)}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border py-2">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  Time
                </span>
                <span className="font-medium text-foreground">{formatTime(selectedTime)}</span>
              </div>
              <div className="flex justify-between border-b border-border py-2">
                <span className="text-muted-foreground">Name</span>
                <span className="font-medium text-foreground">{customerName}</span>
              </div>
              {customerPhone && (
                <div className="flex justify-between border-b border-border py-2">
                  <span className="text-muted-foreground">Phone</span>
                  <span className="font-medium text-foreground">{customerPhone}</span>
                </div>
              )}
              {customerEmail && (
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">Email</span>
                  <span className="font-medium text-foreground">{customerEmail}</span>
                </div>
              )}
            </div>

            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="w-full rounded-xl bg-primary px-4 py-4 text-lg font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Booking...
                </span>
              ) : (
                'Confirm Booking'
              )}
            </button>
            <button
              onClick={handleBack}
              disabled={submitting}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              Back
            </button>
          </div>
        )}

        {/* Success State */}
        {step === 'done' && appointment && (
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-card p-8 text-center shadow-sm">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <Check className="h-8 w-8 text-primary" />
              </div>

              <h2 className="text-2xl font-bold text-foreground">
                Appointment Confirmed!
              </h2>
              <p className="mt-2 text-muted-foreground">
                Your appointment has been booked successfully.
              </p>

              <div className="mt-6 rounded-xl bg-muted p-4">
                <p className="text-sm font-medium text-muted-foreground">
                  Reference Number
                </p>
                <p className="text-2xl font-bold tracking-wider text-primary">
                  {appointment.id.slice(0, 8).toUpperCase()}
                </p>
              </div>

              <div className="mt-6 space-y-3 text-left">
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="font-medium">{selectedDept?.name}</span>
                    {' - '}
                    {selectedService?.name}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{formatDate(selectedDate)}</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{formatTime(selectedTime)}</span>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <p className="text-sm font-medium text-primary">
                  Please arrive a few minutes early to check in.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  You can check in at the kiosk or online when you arrive.
                </p>
              </div>
            </div>

            <button
              onClick={handleStartOver}
              className="w-full rounded-xl bg-primary px-4 py-4 text-lg font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              Book Another Appointment
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pb-6 text-center">
        <p className="text-xs text-muted-foreground">Powered by QueueFlow</p>
      </div>
    </div>
  );
}
