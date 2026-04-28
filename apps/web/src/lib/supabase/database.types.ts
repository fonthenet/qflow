export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      android_tokens: {
        Row: {
          created_at: string
          device_token: string
          id: string
          last_seen_at: string
          package_name: string | null
          ticket_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          device_token: string
          id?: string
          last_seen_at?: string
          package_name?: string | null
          ticket_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          device_token?: string
          id?: string
          last_seen_at?: string
          package_name?: string | null
          ticket_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "android_tokens_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name?: string
          organization_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      apns_tokens: {
        Row: {
          created_at: string | null
          device_token: string
          environment: string
          id: string
          ticket_id: string
        }
        Insert: {
          created_at?: string | null
          device_token: string
          environment?: string
          id?: string
          ticket_id: string
        }
        Update: {
          created_at?: string | null
          device_token?: string
          environment?: string
          id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "apns_tokens_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          calendar_token: string | null
          created_at: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          department_id: string
          id: string
          locale: string | null
          notes: string | null
          office_id: string
          party_size: number | null
          recurrence_parent_id: string | null
          recurrence_rule: string | null
          reminder_sent: boolean | null
          scheduled_at: string
          service_id: string
          source: string | null
          staff_id: string | null
          status: string | null
          ticket_id: string | null
          updated_at: string | null
          wilaya: string | null
        }
        Insert: {
          calendar_token?: string | null
          created_at?: string | null
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          department_id: string
          id?: string
          locale?: string | null
          notes?: string | null
          office_id: string
          party_size?: number | null
          recurrence_parent_id?: string | null
          recurrence_rule?: string | null
          reminder_sent?: boolean | null
          scheduled_at: string
          service_id: string
          source?: string | null
          staff_id?: string | null
          status?: string | null
          ticket_id?: string | null
          updated_at?: string | null
          wilaya?: string | null
        }
        Update: {
          calendar_token?: string | null
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          department_id?: string
          id?: string
          locale?: string | null
          notes?: string | null
          office_id?: string
          party_size?: number | null
          recurrence_parent_id?: string | null
          recurrence_rule?: string | null
          reminder_sent?: boolean | null
          scheduled_at?: string
          service_id?: string
          source?: string | null
          staff_id?: string | null
          status?: string | null
          ticket_id?: string | null
          updated_at?: string | null
          wilaya?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_recurrence_parent_id_fkey"
            columns: ["recurrence_parent_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_appointment_ticket"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action_type: string
          actor_staff_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          office_id: string | null
          organization_id: string
          summary: string
        }
        Insert: {
          action_type: string
          actor_staff_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          office_id?: string | null
          organization_id: string
          summary: string
        }
        Update: {
          action_type?: string
          actor_staff_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          office_id?: string | null
          organization_id?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_staff_id_fkey"
            columns: ["actor_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      banned_customers: {
        Row: {
          banned_at: string
          banned_by: string | null
          created_at: string
          customer_name: string | null
          email: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          messenger_psid: string | null
          organization_id: string
          phone: string | null
          reason: string | null
        }
        Insert: {
          banned_at?: string
          banned_by?: string | null
          created_at?: string
          customer_name?: string | null
          email?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          messenger_psid?: string | null
          organization_id: string
          phone?: string | null
          reason?: string | null
        }
        Update: {
          banned_at?: string
          banned_by?: string | null
          created_at?: string
          customer_name?: string | null
          email?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          messenger_psid?: string | null
          organization_id?: string
          phone?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "banned_customers_banned_by_fkey"
            columns: ["banned_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banned_customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          created_at: string
          data: Json | null
          event_type: string
          id: string
          organization_id: string
          stripe_event_id: string | null
        }
        Insert: {
          created_at?: string
          data?: Json | null
          event_type: string
          id?: string
          organization_id: string
          stripe_event_id?: string | null
        }
        Update: {
          created_at?: string
          data?: Json | null
          event_type?: string
          id?: string
          organization_id?: string
          stripe_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_slots: {
        Row: {
          blocked_date: string
          created_at: string
          created_by: string | null
          end_time: string
          id: string
          office_id: string
          reason: string | null
          start_time: string
        }
        Insert: {
          blocked_date: string
          created_at?: string
          created_by?: string | null
          end_time: string
          id?: string
          office_id: string
          reason?: string | null
          start_time: string
        }
        Update: {
          blocked_date?: string
          created_at?: string
          created_by?: string | null
          end_time?: string
          id?: string
          office_id?: string
          reason?: string | null
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocked_slots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_slots_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_logs: {
        Row: {
          channel: string | null
          created_at: string | null
          id: string
          message: string
          office_id: string | null
          organization_id: string
          recipients_count: number | null
          sent_by: string | null
          template_id: string | null
        }
        Insert: {
          channel?: string | null
          created_at?: string | null
          id?: string
          message: string
          office_id?: string | null
          organization_id: string
          recipients_count?: number | null
          sent_by?: string | null
          template_id?: string | null
        }
        Update: {
          channel?: string | null
          created_at?: string | null
          id?: string
          message?: string
          office_id?: string | null
          organization_id?: string
          recipients_count?: number | null
          sent_by?: string | null
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_logs_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_logs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "broadcast_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_templates: {
        Row: {
          body_ar: string | null
          body_en: string | null
          body_fr: string | null
          created_at: string | null
          id: string
          organization_id: string
          shortcut: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          body_ar?: string | null
          body_en?: string | null
          body_fr?: string | null
          created_at?: string | null
          id?: string
          organization_id: string
          shortcut?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          body_ar?: string | null
          body_en?: string | null
          body_fr?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string
          shortcut?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_webhook_events: {
        Row: {
          channel: string
          id: string
          message_id: string
          organization_id: string | null
          processed_at: string | null
          raw_payload: Json
          received_at: string
          status: string
        }
        Insert: {
          channel: string
          id?: string
          message_id: string
          organization_id?: string | null
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          status?: string
        }
        Update: {
          channel?: string
          id?: string
          message_id?: string
          organization_id?: string | null
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_webhook_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_submissions: {
        Row: {
          company: string | null
          created_at: string | null
          email: string
          id: string
          message: string
          name: string
        }
        Insert: {
          company?: string | null
          created_at?: string | null
          email: string
          id?: string
          message: string
          name: string
        }
        Update: {
          company?: string | null
          created_at?: string | null
          email?: string
          id?: string
          message?: string
          name?: string
        }
        Relationships: []
      }
      country_config: {
        Row: {
          channel_providers: string[]
          code: string
          created_at: string
          currency_code: string
          currency_decimals: number
          currency_symbol: string
          feature_flags: Json
          locale_default: string
          locale_fallbacks: string[]
          name_ar: string
          name_en: string
          name_fr: string
          payment_providers: string[]
          phone_country_code: string
          region: string
          timezone_default: string
          vat_label: string | null
          vat_rate_default: number | null
        }
        Insert: {
          channel_providers?: string[]
          code: string
          created_at?: string
          currency_code: string
          currency_decimals?: number
          currency_symbol: string
          feature_flags?: Json
          locale_default: string
          locale_fallbacks?: string[]
          name_ar: string
          name_en: string
          name_fr: string
          payment_providers?: string[]
          phone_country_code: string
          region: string
          timezone_default: string
          vat_label?: string | null
          vat_rate_default?: number | null
        }
        Update: {
          channel_providers?: string[]
          code?: string
          created_at?: string
          currency_code?: string
          currency_decimals?: number
          currency_symbol?: string
          feature_flags?: Json
          locale_default?: string
          locale_fallbacks?: string[]
          name_ar?: string
          name_en?: string
          name_fr?: string
          payment_providers?: string[]
          phone_country_code?: string
          region?: string
          timezone_default?: string
          vat_label?: string | null
          vat_rate_default?: number | null
        }
        Relationships: []
      }
      customer_imports: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_rows: number | null
          errors: Json | null
          filename: string
          id: string
          imported_by: string | null
          imported_rows: number | null
          organization_id: string
          skipped_rows: number | null
          source: string
          status: string | null
          total_rows: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_rows?: number | null
          errors?: Json | null
          filename: string
          id?: string
          imported_by?: string | null
          imported_rows?: number | null
          organization_id: string
          skipped_rows?: number | null
          source?: string
          status?: string | null
          total_rows?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_rows?: number | null
          errors?: Json | null
          filename?: string
          id?: string
          imported_by?: string | null
          imported_rows?: number | null
          organization_id?: string
          skipped_rows?: number | null
          source?: string
          status?: string | null
          total_rows?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          auto_approve_reservations: boolean
          blood_type: string | null
          booking_count: number | null
          city: string | null
          created_at: string | null
          customer_file: string | null
          date_of_birth: string | null
          deleted_at: string | null
          email: string | null
          file_number: string | null
          gender: string | null
          id: string
          is_banned: boolean | null
          is_couple: boolean | null
          last_booking_at: string | null
          last_visit_at: string | null
          marriage_date: string | null
          name: string | null
          notes: string | null
          organization_id: string
          phone: string | null
          previous_names: Json | null
          source: string | null
          spouse_blood_type: string | null
          spouse_dob: string | null
          spouse_gender: string | null
          spouse_name: string | null
          tags: string[] | null
          updated_at: string | null
          visit_count: number | null
          wilaya_code: string | null
        }
        Insert: {
          address?: string | null
          auto_approve_reservations?: boolean
          blood_type?: string | null
          booking_count?: number | null
          city?: string | null
          created_at?: string | null
          customer_file?: string | null
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string | null
          file_number?: string | null
          gender?: string | null
          id?: string
          is_banned?: boolean | null
          is_couple?: boolean | null
          last_booking_at?: string | null
          last_visit_at?: string | null
          marriage_date?: string | null
          name?: string | null
          notes?: string | null
          organization_id: string
          phone?: string | null
          previous_names?: Json | null
          source?: string | null
          spouse_blood_type?: string | null
          spouse_dob?: string | null
          spouse_gender?: string | null
          spouse_name?: string | null
          tags?: string[] | null
          updated_at?: string | null
          visit_count?: number | null
          wilaya_code?: string | null
        }
        Update: {
          address?: string | null
          auto_approve_reservations?: boolean
          blood_type?: string | null
          booking_count?: number | null
          city?: string | null
          created_at?: string | null
          customer_file?: string | null
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string | null
          file_number?: string | null
          gender?: string | null
          id?: string
          is_banned?: boolean | null
          is_couple?: boolean | null
          last_booking_at?: string | null
          last_visit_at?: string | null
          marriage_date?: string | null
          name?: string | null
          notes?: string | null
          organization_id?: string
          phone?: string | null
          previous_names?: Json | null
          source?: string | null
          spouse_blood_type?: string | null
          spouse_dob?: string | null
          spouse_gender?: string | null
          spouse_name?: string | null
          tags?: string[] | null
          updated_at?: string | null
          visit_count?: number | null
          wilaya_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          office_id: string
          sort_order: number | null
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          office_id: string
          sort_order?: number | null
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          office_id?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "departments_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
        ]
      }
      desk_heartbeats: {
        Row: {
          desk_id: string
          is_online: boolean
          last_ping: string
          staff_id: string | null
        }
        Insert: {
          desk_id: string
          is_online?: boolean
          last_ping?: string
          staff_id?: string | null
        }
        Update: {
          desk_id?: string
          is_online?: boolean
          last_ping?: string
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "desk_heartbeats_desk_id_fkey"
            columns: ["desk_id"]
            isOneToOne: true
            referencedRelation: "desks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "desk_heartbeats_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      desk_services: {
        Row: {
          desk_id: string
          service_id: string
        }
        Insert: {
          desk_id: string
          service_id: string
        }
        Update: {
          desk_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "desk_services_desk_id_fkey"
            columns: ["desk_id"]
            isOneToOne: false
            referencedRelation: "desks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "desk_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      desks: {
        Row: {
          counter_number: number | null
          created_at: string | null
          current_staff_id: string | null
          department_id: string
          display_color: string | null
          display_name: string | null
          id: string
          is_active: boolean | null
          last_active_at: string | null
          last_called_service_id: string | null
          name: string
          office_id: string
          paused_at: string | null
          status: string | null
        }
        Insert: {
          counter_number?: number | null
          created_at?: string | null
          current_staff_id?: string | null
          department_id: string
          display_color?: string | null
          display_name?: string | null
          id?: string
          is_active?: boolean | null
          last_active_at?: string | null
          last_called_service_id?: string | null
          name: string
          office_id: string
          paused_at?: string | null
          status?: string | null
        }
        Update: {
          counter_number?: number | null
          created_at?: string | null
          current_staff_id?: string | null
          department_id?: string
          display_color?: string | null
          display_name?: string | null
          id?: string
          is_active?: boolean | null
          last_active_at?: string | null
          last_called_service_id?: string | null
          name?: string
          office_id?: string
          paused_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "desks_current_staff_id_fkey"
            columns: ["current_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "desks_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "desks_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
        ]
      }
      desktop_connections: {
        Row: {
          app_version: string | null
          created_at: string
          id: string
          ip_address: string | null
          is_online: boolean
          last_ping: string
          last_sync_at: string | null
          machine_id: string
          machine_name: string
          office_id: string | null
          organization_id: string | null
          os_info: string | null
          pending_syncs: number
          rustdesk_id: string | null
          rustdesk_password: string | null
          support_started_at: string | null
          updated_at: string | null
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          is_online?: boolean
          last_ping?: string
          last_sync_at?: string | null
          machine_id: string
          machine_name: string
          office_id?: string | null
          organization_id?: string | null
          os_info?: string | null
          pending_syncs?: number
          rustdesk_id?: string | null
          rustdesk_password?: string | null
          support_started_at?: string | null
          updated_at?: string | null
        }
        Update: {
          app_version?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          is_online?: boolean
          last_ping?: string
          last_sync_at?: string | null
          machine_id?: string
          machine_name?: string
          office_id?: string | null
          organization_id?: string | null
          os_info?: string | null
          pending_syncs?: number
          rustdesk_id?: string | null
          rustdesk_password?: string | null
          support_started_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "desktop_connections_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "desktop_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      display_screens: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          layout: string | null
          name: string
          office_id: string
          screen_token: string
          settings: Json | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          layout?: string | null
          name: string
          office_id: string
          screen_token: string
          settings?: Json | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          layout?: string | null
          name?: string
          office_id?: string
          screen_token?: string
          settings?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "display_screens_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          comment: string | null
          created_at: string | null
          id: string
          rating: number
          service_id: string
          staff_id: string | null
          ticket_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          id?: string
          rating: number
          service_id: string
          staff_id?: string | null
          ticket_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          id?: string
          rating?: number
          service_id?: string
          staff_id?: string | null
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      google_connections: {
        Row: {
          access_token: string | null
          connected_at: string
          google_email: string
          id: string
          organization_id: string
          refresh_token: string
          token_expires_at: string | null
        }
        Insert: {
          access_token?: string | null
          connected_at?: string
          google_email: string
          id?: string
          organization_id: string
          refresh_token: string
          token_expires_at?: string | null
        }
        Update: {
          access_token?: string | null
          connected_at?: string
          google_email?: string
          id?: string
          organization_id?: string
          refresh_token?: string
          token_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "google_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      group_message_recipients: {
        Row: {
          customer_id: string
          delivered_at: string | null
          error_message: string | null
          group_message_id: string
          id: string
          phone: string
          sent_at: string | null
          status: string | null
        }
        Insert: {
          customer_id: string
          delivered_at?: string | null
          error_message?: string | null
          group_message_id: string
          id?: string
          phone: string
          sent_at?: string | null
          status?: string | null
        }
        Update: {
          customer_id?: string
          delivered_at?: string | null
          error_message?: string | null
          group_message_id?: string
          id?: string
          phone?: string
          sent_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_message_recipients_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_message_recipients_group_message_id_fkey"
            columns: ["group_message_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      group_messages: {
        Row: {
          channel: string | null
          completed_at: string | null
          created_at: string | null
          failed_count: number | null
          filter_tags: string[] | null
          id: string
          message_body: string
          organization_id: string
          sent_by: string | null
          sent_count: number | null
          status: string | null
          total_recipients: number | null
        }
        Insert: {
          channel?: string | null
          completed_at?: string | null
          created_at?: string | null
          failed_count?: number | null
          filter_tags?: string[] | null
          id?: string
          message_body: string
          organization_id: string
          sent_by?: string | null
          sent_count?: number | null
          status?: string | null
          total_recipients?: number | null
        }
        Update: {
          channel?: string | null
          completed_at?: string | null
          created_at?: string | null
          failed_count?: number | null
          filter_tags?: string[] | null
          id?: string
          message_body?: string
          organization_id?: string
          sent_by?: string | null
          sent_count?: number | null
          status?: string | null
          total_recipients?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "group_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_form_fields: {
        Row: {
          consent_flag: string | null
          created_at: string | null
          field_label: string
          field_name: string
          field_type: string
          id: string
          is_required: boolean | null
          options: Json | null
          service_id: string
          sort_order: number | null
          visibility: string
        }
        Insert: {
          consent_flag?: string | null
          created_at?: string | null
          field_label: string
          field_name: string
          field_type: string
          id?: string
          is_required?: boolean | null
          options?: Json | null
          service_id: string
          sort_order?: number | null
          visibility?: string
        }
        Update: {
          consent_flag?: string | null
          created_at?: string | null
          field_label?: string
          field_name?: string
          field_type?: string
          id?: string
          is_required?: boolean | null
          options?: Json | null
          service_id?: string
          sort_order?: number | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_form_fields_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          id: string
          invoice_pdf: string | null
          invoice_url: string | null
          organization_id: string
          period_end: string | null
          period_start: string | null
          status: string
          stripe_invoice_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          id?: string
          invoice_pdf?: string | null
          invoice_url?: string | null
          organization_id: string
          period_end?: string | null
          period_start?: string | null
          status?: string
          stripe_invoice_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          invoice_pdf?: string | null
          invoice_url?: string | null
          organization_id?: string
          period_end?: string | null
          period_start?: string | null
          status?: string
          stripe_invoice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          active: boolean
          color: string | null
          created_at: string
          icon: string | null
          id: string
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          active: boolean
          category_id: string
          created_at: string
          discount_percent: number
          id: string
          image_url: string | null
          is_available: boolean
          name: string
          organization_id: string
          prep_time_minutes: number | null
          price: number | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          category_id: string
          created_at?: string
          discount_percent?: number
          id?: string
          image_url?: string | null
          is_available?: boolean
          name: string
          organization_id: string
          prep_time_minutes?: number | null
          price?: number | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          category_id?: string
          created_at?: string
          discount_percent?: number
          id?: string
          image_url?: string | null
          is_available?: boolean
          name?: string
          organization_id?: string
          prep_time_minutes?: number | null
          price?: number | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_failures: {
        Row: {
          channel: string | null
          created_at: string
          error: string
          event: string
          id: string
          ticket_id: string | null
        }
        Insert: {
          channel?: string | null
          created_at?: string
          error: string
          event: string
          id?: string
          ticket_id?: string | null
        }
        Update: {
          channel?: string | null
          created_at?: string
          error?: string
          event?: string
          id?: string
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_failures_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_jobs: {
        Row: {
          action: string
          attempts: number
          channel: string
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          last_error: string | null
          max_attempts: number
          next_retry_at: string
          payload: Json
          status: string
          ticket_id: string | null
        }
        Insert: {
          action: string
          attempts?: number
          channel: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          max_attempts?: number
          next_retry_at?: string
          payload?: Json
          status?: string
          ticket_id?: string | null
        }
        Update: {
          action?: string
          attempts?: number
          channel?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          max_attempts?: number
          next_retry_at?: string
          payload?: Json
          status?: string
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_jobs_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          channel: string | null
          created_at: string | null
          id: string
          payload: Json | null
          read_at: string | null
          sent_at: string | null
          ticket_id: string
          type: string
        }
        Insert: {
          channel?: string | null
          created_at?: string | null
          id?: string
          payload?: Json | null
          read_at?: string | null
          sent_at?: string | null
          ticket_id: string
          type: string
        }
        Update: {
          channel?: string | null
          created_at?: string | null
          id?: string
          payload?: Json | null
          read_at?: string | null
          sent_at?: string | null
          ticket_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      office_holidays: {
        Row: {
          close_time: string | null
          created_at: string | null
          created_by: string | null
          holiday_date: string
          id: string
          is_full_day: boolean | null
          name: string
          office_id: string
          open_time: string | null
        }
        Insert: {
          close_time?: string | null
          created_at?: string | null
          created_by?: string | null
          holiday_date: string
          id?: string
          is_full_day?: boolean | null
          name?: string
          office_id: string
          open_time?: string | null
        }
        Update: {
          close_time?: string | null
          created_at?: string | null
          created_by?: string | null
          holiday_date?: string
          id?: string
          is_full_day?: boolean | null
          name?: string
          office_id?: string
          open_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "office_holidays_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "office_holidays_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
        ]
      }
      offices: {
        Row: {
          address: string | null
          city: string | null
          country: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          operating_hours: Json | null
          organization_id: string
          settings: Json | null
          timezone: string | null
          updated_at: string | null
          wilaya: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          operating_hours?: Json | null
          organization_id: string
          settings?: Json | null
          timezone?: string | null
          updated_at?: string | null
          wilaya?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          operating_hours?: Json | null
          organization_id?: string
          settings?: Json | null
          timezone?: string | null
          updated_at?: string | null
          wilaya?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_sync_queue: {
        Row: {
          action: string
          conflict_reason: string | null
          created_at: string
          desk_id: string | null
          id: string
          idempotency_key: string
          office_id: string
          payload: Json | null
          retry_count: number
          staff_id: string | null
          sync_status: string
          synced_at: string | null
          ticket_id: string | null
        }
        Insert: {
          action: string
          conflict_reason?: string | null
          created_at?: string
          desk_id?: string | null
          id?: string
          idempotency_key: string
          office_id: string
          payload?: Json | null
          retry_count?: number
          staff_id?: string | null
          sync_status?: string
          synced_at?: string | null
          ticket_id?: string | null
        }
        Update: {
          action?: string
          conflict_reason?: string | null
          created_at?: string
          desk_id?: string | null
          id?: string
          idempotency_key?: string
          office_id?: string
          payload?: Json | null
          retry_count?: number
          staff_id?: string | null
          sync_status?: string
          synced_at?: string | null
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offline_sync_queue_desk_id_fkey"
            columns: ["desk_id"]
            isOneToOne: false
            referencedRelation: "desks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_sync_queue_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_sync_queue_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_sync_queue_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      org_payment_methods: {
        Row: {
          config: Json
          created_at: string
          display_order: number
          enabled: boolean
          id: string
          label: string
          organization_id: string
          qr_image_path: string | null
          type: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          display_order?: number
          enabled?: boolean
          id?: string
          label: string
          organization_id: string
          qr_image_path?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          display_order?: number
          enabled?: boolean
          id?: string
          label?: string
          organization_id?: string
          qr_image_path?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_payment_methods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          billing_period: string
          business_subtype: string | null
          business_type: string | null
          country: string | null
          created_at: string | null
          currency_override: string | null
          current_period_end: string | null
          external_idempotency_key: string | null
          id: string
          locale_fallbacks: string[] | null
          locale_primary: string | null
          logo_url: string | null
          monthly_visit_count: number
          name: string
          name_ar: string | null
          plan_id: string
          settings: Json | null
          slug: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string
          timezone: string | null
          trial_ends_at: string | null
          updated_at: string | null
          vertical: string | null
          visit_count_reset_at: string
          whatsapp_access_token_encrypted: string | null
          whatsapp_business_account_id: string | null
          whatsapp_phone_number_id: string | null
          whatsapp_verify_token: string | null
        }
        Insert: {
          billing_period?: string
          business_subtype?: string | null
          business_type?: string | null
          country?: string | null
          created_at?: string | null
          currency_override?: string | null
          current_period_end?: string | null
          external_idempotency_key?: string | null
          id?: string
          locale_fallbacks?: string[] | null
          locale_primary?: string | null
          logo_url?: string | null
          monthly_visit_count?: number
          name: string
          name_ar?: string | null
          plan_id?: string
          settings?: Json | null
          slug: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string
          timezone?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
          vertical?: string | null
          visit_count_reset_at?: string
          whatsapp_access_token_encrypted?: string | null
          whatsapp_business_account_id?: string | null
          whatsapp_phone_number_id?: string | null
          whatsapp_verify_token?: string | null
        }
        Update: {
          billing_period?: string
          business_subtype?: string | null
          business_type?: string | null
          country?: string | null
          created_at?: string | null
          currency_override?: string | null
          current_period_end?: string | null
          external_idempotency_key?: string | null
          id?: string
          locale_fallbacks?: string[] | null
          locale_primary?: string | null
          logo_url?: string | null
          monthly_visit_count?: number
          name?: string
          name_ar?: string | null
          plan_id?: string
          settings?: Json | null
          slug?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string
          timezone?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
          vertical?: string | null
          visit_count_reset_at?: string
          whatsapp_access_token_encrypted?: string | null
          whatsapp_business_account_id?: string | null
          whatsapp_phone_number_id?: string | null
          whatsapp_verify_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_country_fkey"
            columns: ["country"]
            isOneToOne: false
            referencedRelation: "country_config"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "organizations_vertical_fkey"
            columns: ["vertical"]
            isOneToOne: false
            referencedRelation: "verticals"
            referencedColumns: ["slug"]
          },
        ]
      }
      payment_events: {
        Row: {
          amount: number | null
          currency: string | null
          event_type: string
          id: string
          metadata: Json | null
          minimized_at: string | null
          organization_id: string | null
          processed_at: string | null
          provider: string
          provider_event_id: string
          purged_at: string | null
          raw_payload: Json | null
          received_at: string
          status: string
        }
        Insert: {
          amount?: number | null
          currency?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          minimized_at?: string | null
          organization_id?: string | null
          processed_at?: string | null
          provider: string
          provider_event_id: string
          purged_at?: string | null
          raw_payload?: Json | null
          received_at?: string
          status?: string
        }
        Update: {
          amount?: number | null
          currency?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          minimized_at?: string | null
          organization_id?: string | null
          processed_at?: string | null
          provider?: string
          provider_event_id?: string
          purged_at?: string | null
          raw_payload?: Json | null
          received_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_device_activations: {
        Row: {
          approved_license_id: string | null
          id: string
          ip_address: string | null
          machine_id: string
          machine_name: string | null
          requested_at: string | null
          status: string
        }
        Insert: {
          approved_license_id?: string | null
          id?: string
          ip_address?: string | null
          machine_id: string
          machine_name?: string | null
          requested_at?: string | null
          status?: string
        }
        Update: {
          approved_license_id?: string | null
          id?: string
          ip_address?: string | null
          machine_id?: string
          machine_name?: string | null
          requested_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_device_activations_approved_license_id_fkey"
            columns: ["approved_license_id"]
            isOneToOne: false
            referencedRelation: "station_licenses"
            referencedColumns: ["id"]
          },
        ]
      }
      priority_categories: {
        Row: {
          color: string | null
          created_at: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          weight: number | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          weight?: number | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "priority_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string | null
          endpoint: string
          id: string
          p256dh: string
          ticket_id: string
        }
        Insert: {
          auth: string
          created_at?: string | null
          endpoint: string
          id?: string
          p256dh: string
          ticket_id: string
        }
        Update: {
          auth?: string
          created_at?: string | null
          endpoint?: string
          id?: string
          p256dh?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_tables: {
        Row: {
          assigned_at: string | null
          capacity: number | null
          code: string
          created_at: string
          current_ticket_id: string | null
          id: string
          label: string
          max_party_size: number | null
          min_party_size: number | null
          office_id: string
          reservable: boolean | null
          status: string
          updated_at: string
          zone: string | null
        }
        Insert: {
          assigned_at?: string | null
          capacity?: number | null
          code: string
          created_at?: string
          current_ticket_id?: string | null
          id?: string
          label: string
          max_party_size?: number | null
          min_party_size?: number | null
          office_id: string
          reservable?: boolean | null
          status?: string
          updated_at?: string
          zone?: string | null
        }
        Update: {
          assigned_at?: string | null
          capacity?: number | null
          code?: string
          created_at?: string
          current_ticket_id?: string | null
          id?: string
          label?: string
          max_party_size?: number | null
          min_party_size?: number | null
          office_id?: string
          reservable?: boolean | null
          status?: string
          updated_at?: string
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_tables_current_ticket_id_fkey"
            columns: ["current_ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_tables_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          code: string
          color: string | null
          created_at: string | null
          department_id: string
          description: string | null
          estimated_service_time: number | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          priority: number | null
          sort_order: number | null
        }
        Insert: {
          code: string
          color?: string | null
          created_at?: string | null
          department_id: string
          description?: string | null
          estimated_service_time?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          priority?: number | null
          sort_order?: number | null
        }
        Update: {
          code?: string
          color?: string | null
          created_at?: string | null
          department_id?: string
          description?: string | null
          estimated_service_time?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          priority?: number | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "services_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_links: {
        Row: {
          auto_sync: boolean
          created_at: string
          id: string
          last_error: string | null
          last_error_at: string | null
          last_pushed_at: string | null
          last_row_count: number | null
          last_success_at: string | null
          organization_id: string
          sheet_id: string
          sheet_name: string | null
          sheet_url: string | null
        }
        Insert: {
          auto_sync?: boolean
          created_at?: string
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_pushed_at?: string | null
          last_row_count?: number | null
          last_success_at?: string | null
          organization_id: string
          sheet_id: string
          sheet_name?: string | null
          sheet_url?: string | null
        }
        Update: {
          auto_sync?: boolean
          created_at?: string
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_pushed_at?: string | null
          last_row_count?: number | null
          last_success_at?: string | null
          organization_id?: string
          sheet_id?: string
          sheet_name?: string | null
          sheet_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sheet_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      slot_waitlist: {
        Row: {
          created_at: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          id: string
          notified_at: string | null
          office_id: string
          requested_date: string
          requested_time: string
          service_id: string
          status: string | null
        }
        Insert: {
          created_at?: string | null
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          id?: string
          notified_at?: string | null
          office_id: string
          requested_date: string
          requested_time: string
          service_id: string
          status?: string | null
        }
        Update: {
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          id?: string
          notified_at?: string | null
          office_id?: string
          requested_date?: string
          requested_time?: string
          service_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "slot_waitlist_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_waitlist_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          auth_user_id: string
          created_at: string | null
          default_slot_duration_minutes: number | null
          department_id: string | null
          email: string
          full_name: string
          id: string
          is_active: boolean | null
          office_id: string | null
          organization_id: string
          role: string
          work_schedule: Json | null
        }
        Insert: {
          auth_user_id: string
          created_at?: string | null
          default_slot_duration_minutes?: number | null
          department_id?: string | null
          email: string
          full_name: string
          id?: string
          is_active?: boolean | null
          office_id?: string | null
          organization_id: string
          role: string
          work_schedule?: Json | null
        }
        Update: {
          auth_user_id?: string
          created_at?: string | null
          default_slot_duration_minutes?: number | null
          department_id?: string | null
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean | null
          office_id?: string | null
          organization_id?: string
          role?: string
          work_schedule?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      station_licenses: {
        Row: {
          activated_at: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          license_key: string
          machine_id: string | null
          machine_name: string | null
          notes: string | null
          organization_id: string | null
          organization_name: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          activated_at?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          license_key: string
          machine_id?: string | null
          machine_name?: string | null
          notes?: string | null
          organization_id?: string | null
          organization_name?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          activated_at?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          license_key?: string
          machine_id?: string | null
          machine_name?: string | null
          notes?: string | null
          organization_id?: string | null
          organization_name?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "station_licenses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      template_health_snapshots: {
        Row: {
          actor_staff_id: string | null
          applied_version: string
          branch_alignment_percent: number
          created_at: string
          current_version_coverage_percent: number
          id: string
          latest_version: string
          metadata: Json
          office_count: number
          office_drift_count: number
          office_id: string | null
          offices_behind_count: number
          offices_current_count: number
          offices_with_drift: number
          organization_drift_count: number
          organization_id: string
          snapshot_scope: string
          snapshot_type: string
          template_id: string
        }
        Insert: {
          actor_staff_id?: string | null
          applied_version: string
          branch_alignment_percent?: number
          created_at?: string
          current_version_coverage_percent?: number
          id?: string
          latest_version: string
          metadata?: Json
          office_count?: number
          office_drift_count?: number
          office_id?: string | null
          offices_behind_count?: number
          offices_current_count?: number
          offices_with_drift?: number
          organization_drift_count?: number
          organization_id: string
          snapshot_scope: string
          snapshot_type: string
          template_id: string
        }
        Update: {
          actor_staff_id?: string | null
          applied_version?: string
          branch_alignment_percent?: number
          created_at?: string
          current_version_coverage_percent?: number
          id?: string
          latest_version?: string
          metadata?: Json
          office_count?: number
          office_drift_count?: number
          office_id?: string | null
          offices_behind_count?: number
          offices_current_count?: number
          offices_with_drift?: number
          organization_drift_count?: number
          organization_id?: string
          snapshot_scope?: string
          snapshot_type?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_health_snapshots_actor_staff_id_fkey"
            columns: ["actor_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_health_snapshots_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_health_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_events: {
        Row: {
          created_at: string | null
          desk_id: string | null
          event_type: string
          from_status: string | null
          id: string
          idempotency_key: string | null
          metadata: Json | null
          source: string | null
          staff_id: string | null
          ticket_id: string
          to_status: string | null
        }
        Insert: {
          created_at?: string | null
          desk_id?: string | null
          event_type: string
          from_status?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          source?: string | null
          staff_id?: string | null
          ticket_id: string
          to_status?: string | null
        }
        Update: {
          created_at?: string | null
          desk_id?: string | null
          event_type?: string
          from_status?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          source?: string | null
          staff_id?: string | null
          ticket_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_events_desk_id_fkey"
            columns: ["desk_id"]
            isOneToOne: false
            referencedRelation: "desks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_events_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_items: {
        Row: {
          added_at: string
          added_by: string | null
          id: string
          kitchen_status: string
          kitchen_status_at: string | null
          menu_item_id: string | null
          name: string
          note: string | null
          organization_id: string
          price: number | null
          qty: number
          ticket_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          id?: string
          kitchen_status?: string
          kitchen_status_at?: string | null
          menu_item_id?: string | null
          name: string
          note?: string | null
          organization_id: string
          price?: number | null
          qty?: number
          ticket_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          id?: string
          kitchen_status?: string
          kitchen_status_at?: string | null
          menu_item_id?: string | null
          name?: string
          note?: string | null
          organization_id?: string
          price?: number | null
          qty?: number
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_items_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_payments: {
        Row: {
          amount: number
          change_given: number | null
          id: string
          method: string
          note: string | null
          organization_id: string
          paid_at: string
          paid_by: string | null
          tendered: number | null
          ticket_id: string
        }
        Insert: {
          amount: number
          change_given?: number | null
          id?: string
          method?: string
          note?: string | null
          organization_id: string
          paid_at?: string
          paid_by?: string | null
          tendered?: number | null
          ticket_id: string
        }
        Update: {
          amount?: number
          change_given?: number | null
          id?: string
          method?: string
          note?: string | null
          organization_id?: string
          paid_at?: string
          paid_by?: string | null
          tendered?: number | null
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_payments_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_payments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_sequences: {
        Row: {
          department_id: string
          last_sequence: number
          updated_at: string
        }
        Insert: {
          department_id: string
          last_sequence?: number
          updated_at?: string
        }
        Update: {
          department_id?: string
          last_sequence?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_sequences_v2_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: true
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          appointment_id: string | null
          called_at: string | null
          called_by_staff_id: string | null
          checked_in_at: string | null
          completed_at: string | null
          created_at: string | null
          customer_data: Json | null
          customer_id: string | null
          daily_sequence: number | null
          delivery_address: Json | null
          department_id: string
          desk_id: string | null
          estimated_wait_minutes: number | null
          group_id: string | null
          id: string
          is_remote: boolean | null
          locale: string | null
          notes: string | null
          office_id: string
          parked_at: string | null
          payment_status: string | null
          priority: number | null
          priority_category_id: string | null
          qr_token: string
          recall_count: number
          service_id: string | null
          serving_started_at: string | null
          source: string | null
          status: string
          ticket_number: string
          transferred_from_ticket_id: string | null
        }
        Insert: {
          appointment_id?: string | null
          called_at?: string | null
          called_by_staff_id?: string | null
          checked_in_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          customer_data?: Json | null
          customer_id?: string | null
          daily_sequence?: number | null
          delivery_address?: Json | null
          department_id: string
          desk_id?: string | null
          estimated_wait_minutes?: number | null
          group_id?: string | null
          id?: string
          is_remote?: boolean | null
          locale?: string | null
          notes?: string | null
          office_id: string
          parked_at?: string | null
          payment_status?: string | null
          priority?: number | null
          priority_category_id?: string | null
          qr_token: string
          recall_count?: number
          service_id?: string | null
          serving_started_at?: string | null
          source?: string | null
          status?: string
          ticket_number: string
          transferred_from_ticket_id?: string | null
        }
        Update: {
          appointment_id?: string | null
          called_at?: string | null
          called_by_staff_id?: string | null
          checked_in_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          customer_data?: Json | null
          customer_id?: string | null
          daily_sequence?: number | null
          delivery_address?: Json | null
          department_id?: string
          desk_id?: string | null
          estimated_wait_minutes?: number | null
          group_id?: string | null
          id?: string
          is_remote?: boolean | null
          locale?: string | null
          notes?: string | null
          office_id?: string
          parked_at?: string | null
          payment_status?: string | null
          priority?: number | null
          priority_category_id?: string | null
          qr_token?: string
          recall_count?: number
          service_id?: string | null
          serving_started_at?: string | null
          source?: string | null
          status?: string
          ticket_number?: string
          transferred_from_ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_called_by_staff_id_fkey"
            columns: ["called_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_desk_id_fkey"
            columns: ["desk_id"]
            isOneToOne: false
            referencedRelation: "desks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_priority_category_id_fkey"
            columns: ["priority_category_id"]
            isOneToOne: false
            referencedRelation: "priority_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_transferred_from_ticket_id_fkey"
            columns: ["transferred_from_ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      translations: {
        Row: {
          id: string
          key: string
          locale: string
          organization_id: string
          value: string
        }
        Insert: {
          id?: string
          key: string
          locale: string
          organization_id: string
          value: string
        }
        Update: {
          id?: string
          key?: string
          locale?: string
          organization_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "translations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_data_exports: {
        Row: {
          export_count: number
          last_export_at: string
          user_id: string
        }
        Insert: {
          export_count?: number
          last_export_at?: string
          user_id: string
        }
        Update: {
          export_count?: number
          last_export_at?: string
          user_id?: string
        }
        Relationships: []
      }
      verticals: {
        Row: {
          category: string
          created_at: string
          default_modules: string[]
          default_terminology: Json
          name_ar: string
          name_en: string
          name_fr: string
          slug: string
        }
        Insert: {
          category: string
          created_at?: string
          default_modules?: string[]
          default_terminology?: Json
          name_ar: string
          name_en: string
          name_fr: string
          slug: string
        }
        Update: {
          category?: string
          created_at?: string
          default_modules?: string[]
          default_terminology?: Json
          name_ar?: string
          name_en?: string
          name_fr?: string
          slug?: string
        }
        Relationships: []
      }
      virtual_queue_codes: {
        Row: {
          created_at: string | null
          department_id: string | null
          id: string
          is_active: boolean | null
          office_id: string | null
          organization_id: string
          qr_token: string
          service_id: string | null
        }
        Insert: {
          created_at?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean | null
          office_id?: string | null
          organization_id: string
          qr_token: string
          service_id?: string | null
        }
        Update: {
          created_at?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean | null
          office_id?: string | null
          organization_id?: string
          qr_token?: string
          service_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "virtual_queue_codes_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "virtual_queue_codes_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "virtual_queue_codes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "virtual_queue_codes_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          delivered_at: string
          endpoint_id: string
          event_type: string
          id: string
          payload: Json
          response_body: string | null
          response_status: number | null
        }
        Insert: {
          delivered_at?: string
          endpoint_id: string
          event_type: string
          id?: string
          payload: Json
          response_body?: string | null
          response_status?: number | null
        }
        Update: {
          delivered_at?: string
          endpoint_id?: string
          event_type?: string
          id?: string
          payload?: Json
          response_body?: string | null
          response_status?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          created_at: string
          events: string[]
          failure_count: number
          id: string
          is_active: boolean
          last_triggered_at: string | null
          organization_id: string
          secret: string
          url: string
        }
        Insert: {
          created_at?: string
          events?: string[]
          failure_count?: number
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          organization_id: string
          secret: string
          url: string
        }
        Update: {
          created_at?: string
          events?: string[]
          failure_count?: number
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          organization_id?: string
          secret?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_endpoints_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_message_templates: {
        Row: {
          components: Json | null
          created_at: string
          id: string
          locale: string
          organization_id: string | null
          purpose: string
          status: string
          template_lang: string
          template_name: string
          updated_at: string
        }
        Insert: {
          components?: Json | null
          created_at?: string
          id?: string
          locale?: string
          organization_id?: string | null
          purpose: string
          status?: string
          template_lang?: string
          template_name: string
          updated_at?: string
        }
        Update: {
          components?: Json | null
          created_at?: string
          id?: string
          locale?: string
          organization_id?: string | null
          purpose?: string
          status?: string
          template_lang?: string
          template_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_sessions: {
        Row: {
          booking_customer_name: string | null
          booking_customer_wilaya: string | null
          booking_date: string | null
          booking_time: string | null
          channel: string
          created_at: string | null
          custom_intake_data: Json | null
          department_id: string | null
          id: string
          intake_reason: string | null
          intake_wilaya: string | null
          last_message_at: string | null
          last_notified_position: number | null
          locale: string | null
          messenger_psid: string | null
          office_id: string | null
          organization_id: string
          otn_token: string | null
          service_id: string | null
          state: string
          ticket_id: string | null
          virtual_queue_code_id: string | null
          whatsapp_bsuid: string | null
          whatsapp_phone: string | null
        }
        Insert: {
          booking_customer_name?: string | null
          booking_customer_wilaya?: string | null
          booking_date?: string | null
          booking_time?: string | null
          channel?: string
          created_at?: string | null
          custom_intake_data?: Json | null
          department_id?: string | null
          id?: string
          intake_reason?: string | null
          intake_wilaya?: string | null
          last_message_at?: string | null
          last_notified_position?: number | null
          locale?: string | null
          messenger_psid?: string | null
          office_id?: string | null
          organization_id: string
          otn_token?: string | null
          service_id?: string | null
          state?: string
          ticket_id?: string | null
          virtual_queue_code_id?: string | null
          whatsapp_bsuid?: string | null
          whatsapp_phone?: string | null
        }
        Update: {
          booking_customer_name?: string | null
          booking_customer_wilaya?: string | null
          booking_date?: string | null
          booking_time?: string | null
          channel?: string
          created_at?: string | null
          custom_intake_data?: Json | null
          department_id?: string | null
          id?: string
          intake_reason?: string | null
          intake_wilaya?: string | null
          last_message_at?: string | null
          last_notified_position?: number | null
          locale?: string | null
          messenger_psid?: string | null
          office_id?: string | null
          organization_id?: string
          otn_token?: string | null
          service_id?: string | null
          state?: string
          ticket_id?: string | null
          virtual_queue_code_id?: string | null
          whatsapp_bsuid?: string | null
          whatsapp_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_sessions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sessions_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sessions_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sessions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sessions_virtual_queue_code_id_fkey"
            columns: ["virtual_queue_code_id"]
            isOneToOne: false
            referencedRelation: "virtual_queue_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_webhook_events: {
        Row: {
          id: string
          message_id: string
          organization_id: string | null
          phone_number_id: string
          processed_at: string | null
          raw_payload: Json
          received_at: string
          status: string
        }
        Insert: {
          id?: string
          message_id: string
          organization_id?: string | null
          phone_number_id: string
          processed_at?: string | null
          raw_payload: Json
          received_at?: string
          status?: string
        }
        Update: {
          id?: string
          message_id?: string
          organization_id?: string | null
          phone_number_id?: string
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_webhook_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_booking_priorities: { Args: never; Returns: number }
      auto_resolve_tickets: { Args: never; Returns: Json }
      broadcast_recall: {
        Args: {
          p_desk_id?: string
          p_office_id: string
          p_ticket_id: string
          p_ticket_number: string
        }
        Returns: undefined
      }
      call_next_ticket: {
        Args: { p_desk_id: string; p_staff_id: string }
        Returns: string
      }
      call_next_ticket_round_robin: {
        Args: { p_desk_id: string; p_staff_id: string }
        Returns: string
      }
      call_next_ticket_with_overflow: {
        Args: { p_desk_id: string; p_staff_id: string }
        Returns: string
      }
      cleanup_old_ticket_events: { Args: never; Returns: number }
      cleanup_stale_sessions: { Args: never; Returns: number }
      cleanup_stale_tickets: { Args: never; Returns: number }
      create_organization_with_admin: {
        Args: {
          p_admin_email: string
          p_admin_name: string
          p_auth_user_id: string
          p_org_name: string
          p_org_slug: string
        }
        Returns: string
      }
      desk_heartbeat: {
        Args: { p_desk_id: string; p_staff_id: string }
        Returns: undefined
      }
      estimate_wait_time: {
        Args: { p_department_id: string; p_service_id: string }
        Returns: number
      }
      generate_daily_ticket_number: {
        Args: { p_department_id: string }
        Returns: {
          seq: number
          ticket_num: string
        }[]
      }
      get_my_org_id: { Args: never; Returns: string }
      get_queue_position: { Args: { p_ticket_id: string }; Returns: Json }
      is_customer_banned: {
        Args: {
          p_email?: string
          p_org_id: string
          p_phone?: string
          p_psid?: string
        }
        Returns: boolean
      }
      mark_no_show_appointments: { Args: never; Returns: number }
      minimize_payment_events: { Args: never; Returns: number }
      normalize_phone_to_local: {
        Args: { office_id_input?: string; raw_phone: string }
        Returns: string
      }
      office_local_date: { Args: { ts: string; tz: string }; Returns: string }
      park_inactive_desk_tickets: {
        Args: { p_timeout_minutes?: number }
        Returns: number
      }
      purge_payment_events: { Args: never; Returns: number }
      recover_stuck_tickets: { Args: never; Returns: Json }
      requeue_desk_tickets: { Args: { p_desk_id: string }; Returns: number }
      requeue_expired_calls: {
        Args: { p_timeout_seconds?: number }
        Returns: number
      }
      reservation_turn_minutes: {
        Args: { p_party_size: number; p_settings: Json }
        Returns: number
      }
      reset_monthly_visit_counts: { Args: never; Returns: undefined }
      retry_missed_notifications: { Args: never; Returns: undefined }
      update_booking_priorities: { Args: never; Returns: number }
      upsert_org_whatsapp_credentials: {
        Args: {
          p_access_token_encrypted: string
          p_business_account_id: string
          p_org_id: string
          p_phone_number_id: string
          p_verify_token: string
        }
        Returns: undefined
      }
      utc_date: { Args: { ts: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

