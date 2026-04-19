export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      appointments: {
        Row: {
          created_at: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          department_id: string
          id: string
          notes: string | null
          office_id: string
          scheduled_at: string
          service_id: string
          status: string | null
          ticket_id: string | null
        }
        Insert: {
          created_at?: string | null
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          department_id: string
          id?: string
          notes?: string | null
          office_id: string
          scheduled_at: string
          service_id: string
          status?: string | null
          ticket_id?: string | null
        }
        Update: {
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          department_id?: string
          id?: string
          notes?: string | null
          office_id?: string
          scheduled_at?: string
          service_id?: string
          status?: string | null
          ticket_id?: string | null
        }
        Relationships: []
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
        Relationships: []
      }
      customers: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          last_visit_at: string | null
          name: string | null
          organization_id: string
          phone: string
          visit_count: number | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          last_visit_at?: string | null
          name?: string | null
          organization_id: string
          phone: string
          visit_count?: number | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          last_visit_at?: string | null
          name?: string | null
          organization_id?: string
          phone?: string
          visit_count?: number | null
        }
        Relationships: []
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
        Relationships: []
      }
      desk_services: {
        Row: { desk_id: string; service_id: string }
        Insert: { desk_id: string; service_id: string }
        Update: { desk_id?: string; service_id?: string }
        Relationships: []
      }
      desks: {
        Row: {
          created_at: string | null
          current_staff_id: string | null
          department_id: string
          display_name: string | null
          id: string
          is_active: boolean | null
          name: string
          office_id: string
          status: string | null
        }
        Insert: {
          created_at?: string | null
          current_staff_id?: string | null
          department_id: string
          display_name?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          office_id: string
          status?: string | null
        }
        Update: {
          created_at?: string | null
          current_staff_id?: string | null
          department_id?: string
          display_name?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          office_id?: string
          status?: string | null
        }
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
      }
      organizations: {
        Row: {
          created_at: string | null
          id: string
          logo_url: string | null
          name: string
          settings: Json | null
          slug: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          logo_url?: string | null
          name: string
          settings?: Json | null
          slug: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          settings?: Json | null
          slug?: string
          updated_at?: string | null
        }
        Relationships: []
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
        Relationships: []
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
        Relationships: []
      }
      services: {
        Row: {
          code: string
          created_at: string | null
          department_id: string
          description: string | null
          estimated_service_time: number | null
          id: string
          is_active: boolean | null
          name: string
          priority: number | null
          sort_order: number | null
        }
        Insert: {
          code: string
          created_at?: string | null
          department_id: string
          description?: string | null
          estimated_service_time?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          priority?: number | null
          sort_order?: number | null
        }
        Update: {
          code?: string
          created_at?: string | null
          department_id?: string
          description?: string | null
          estimated_service_time?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          priority?: number | null
          sort_order?: number | null
        }
        Relationships: []
      }
      staff: {
        Row: {
          auth_user_id: string
          created_at: string | null
          department_id: string | null
          email: string
          full_name: string
          id: string
          is_active: boolean | null
          office_id: string | null
          organization_id: string
          role: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string | null
          department_id?: string | null
          email: string
          full_name: string
          id?: string
          is_active?: boolean | null
          office_id?: string | null
          organization_id: string
          role: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string | null
          department_id?: string | null
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean | null
          office_id?: string | null
          organization_id?: string
          role?: string
        }
        Relationships: []
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
        Relationships: []
      }
      ticket_events: {
        Row: {
          created_at: string | null
          desk_id: string | null
          event_type: string
          from_status: string | null
          id: string
          metadata: Json | null
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
          metadata?: Json | null
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
          metadata?: Json | null
          staff_id?: string | null
          ticket_id?: string
          to_status?: string | null
        }
        Relationships: []
      }
      ticket_sequences: {
        Row: {
          department_id: string
          id: string
          last_sequence: number | null
          seq_date: string
        }
        Insert: {
          department_id: string
          id?: string
          last_sequence?: number | null
          seq_date?: string
        }
        Update: {
          department_id?: string
          id?: string
          last_sequence?: number | null
          seq_date?: string
        }
        Relationships: []
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
          daily_sequence: number
          department_id: string
          desk_id: string | null
          estimated_wait_minutes: number | null
          group_id: string | null
          id: string
          is_remote: boolean | null
          notes: string | null
          office_id: string
          priority: number | null
          priority_category_id: string | null
          qr_token: string
          parked_at: string | null
          recall_count: number
          service_id: string
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
          daily_sequence: number
          department_id: string
          desk_id?: string | null
          estimated_wait_minutes?: number | null
          group_id?: string | null
          id?: string
          is_remote?: boolean | null
          notes?: string | null
          office_id: string
          priority?: number | null
          priority_category_id?: string | null
          qr_token: string
          parked_at?: string | null
          recall_count?: number
          service_id: string
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
          daily_sequence?: number
          department_id?: string
          desk_id?: string | null
          estimated_wait_minutes?: number | null
          group_id?: string | null
          id?: string
          is_remote?: boolean | null
          notes?: string | null
          office_id?: string
          priority?: number | null
          priority_category_id?: string | null
          qr_token?: string
          parked_at?: string | null
          recall_count?: number
          service_id?: string
          serving_started_at?: string | null
          source?: string | null
          status?: string
          ticket_number?: string
          transferred_from_ticket_id?: string | null
        }
        Relationships: []
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
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      call_next_ticket: {
        Args: { p_desk_id: string; p_staff_id: string }
        Returns: string
      }
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
      estimate_wait_time: {
        Args: { p_department_id: string; p_service_id: string }
        Returns: number
      }
      generate_daily_ticket_number: {
        Args: { p_department_id: string }
        Returns: { seq: number; ticket_num: string }[]
      }
      get_my_org_id: { Args: never; Returns: string }
      get_queue_position: { Args: { p_ticket_id: string }; Returns: Record<string, unknown> }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
