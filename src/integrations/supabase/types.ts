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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          created_at: string
          description: string | null
          icon: string | null
          id: string
          link: string | null
          metadata: Json | null
          owner_id: string
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          link?: string | null
          metadata?: Json | null
          owner_id: string
          title: string
          type: string
        }
        Update: {
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          link?: string | null
          metadata?: Json | null
          owner_id?: string
          title?: string
          type?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json | null
          resource_id: string | null
          resource_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          resource_id?: string | null
          resource_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          resource_id?: string | null
          resource_type?: string | null
        }
        Relationships: []
      }
      content_audits: {
        Row: {
          aeo_score: number | null
          ai_summary: string | null
          created_at: string
          eeat_score: number | null
          id: string
          owner_id: string
          quality_score: number | null
          recommendations: Json | null
          site_id: string
          status: Database["public"]["Enums"]["audit_status"]
          title: string | null
          updated_at: string
          url: string
        }
        Insert: {
          aeo_score?: number | null
          ai_summary?: string | null
          created_at?: string
          eeat_score?: number | null
          id?: string
          owner_id: string
          quality_score?: number | null
          recommendations?: Json | null
          site_id: string
          status?: Database["public"]["Enums"]["audit_status"]
          title?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          aeo_score?: number | null
          ai_summary?: string | null
          created_at?: string
          eeat_score?: number | null
          id?: string
          owner_id?: string
          quality_score?: number | null
          recommendations?: Json | null
          site_id?: string
          status?: Database["public"]["Enums"]["audit_status"]
          title?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_audits_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      content_briefs: {
        Row: {
          aeo_questions: Json | null
          ai_generated: boolean | null
          created_at: string
          geo_signals: Json | null
          id: string
          internal_links: Json | null
          outline: Json | null
          owner_id: string
          search_intent: string | null
          site_id: string
          target_keyword: string | null
          title: string
          updated_at: string
          word_count_target: number | null
        }
        Insert: {
          aeo_questions?: Json | null
          ai_generated?: boolean | null
          created_at?: string
          geo_signals?: Json | null
          id?: string
          internal_links?: Json | null
          outline?: Json | null
          owner_id: string
          search_intent?: string | null
          site_id: string
          target_keyword?: string | null
          title: string
          updated_at?: string
          word_count_target?: number | null
        }
        Update: {
          aeo_questions?: Json | null
          ai_generated?: boolean | null
          created_at?: string
          geo_signals?: Json | null
          id?: string
          internal_links?: Json | null
          outline?: Json | null
          owner_id?: string
          search_intent?: string | null
          site_id?: string
          target_keyword?: string | null
          title?: string
          updated_at?: string
          word_count_target?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "content_briefs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          config: Json | null
          created_at: string
          id: string
          is_active: boolean | null
          last_used_at: string | null
          owner_id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          site_id: string | null
          updated_at: string
        }
        Insert: {
          config?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_used_at?: string | null
          owner_id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          site_id?: string | null
          updated_at?: string
        }
        Update: {
          config?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_used_at?: string | null
          owner_id?: string
          provider?: Database["public"]["Enums"]["integration_provider"]
          site_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          job_title: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          job_title?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          job_title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sites: {
        Row: {
          created_at: string
          ga4_property_id: string | null
          gsc_property: string | null
          health_score: number | null
          id: string
          last_synced_at: string | null
          monthly_clicks: number | null
          monthly_impressions: number | null
          name: string
          owner_id: string
          status: Database["public"]["Enums"]["site_status"]
          topical_authority_score: number | null
          total_posts: number | null
          updated_at: string
          url: string
          wp_username: string | null
        }
        Insert: {
          created_at?: string
          ga4_property_id?: string | null
          gsc_property?: string | null
          health_score?: number | null
          id?: string
          last_synced_at?: string | null
          monthly_clicks?: number | null
          monthly_impressions?: number | null
          name: string
          owner_id: string
          status?: Database["public"]["Enums"]["site_status"]
          topical_authority_score?: number | null
          total_posts?: number | null
          updated_at?: string
          url: string
          wp_username?: string | null
        }
        Update: {
          created_at?: string
          ga4_property_id?: string | null
          gsc_property?: string | null
          health_score?: number | null
          id?: string
          last_synced_at?: string | null
          monthly_clicks?: number | null
          monthly_impressions?: number | null
          name?: string
          owner_id?: string
          status?: Database["public"]["Enums"]["site_status"]
          topical_authority_score?: number | null
          total_posts?: number | null
          updated_at?: string
          url?: string
          wp_username?: string | null
        }
        Relationships: []
      }
      tasks: {
        Row: {
          assignee_id: string | null
          brief_id: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          owner_id: string
          priority: Database["public"]["Enums"]["task_priority"]
          site_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          brief_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          owner_id: string
          priority?: Database["public"]["Enums"]["task_priority"]
          site_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          brief_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          owner_id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          site_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "content_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      topical_maps: {
        Row: {
          cluster: string | null
          coverage_status: string | null
          created_at: string
          id: string
          intent: string | null
          owner_id: string
          parent_id: string | null
          pillar: string
          priority: number | null
          site_id: string
          updated_at: string
        }
        Insert: {
          cluster?: string | null
          coverage_status?: string | null
          created_at?: string
          id?: string
          intent?: string | null
          owner_id: string
          parent_id?: string | null
          pillar: string
          priority?: number | null
          site_id: string
          updated_at?: string
        }
        Update: {
          cluster?: string | null
          coverage_status?: string | null
          created_at?: string
          id?: string
          intent?: string | null
          owner_id?: string
          parent_id?: string | null
          pillar?: string
          priority?: number | null
          site_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topical_maps_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "topical_maps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topical_maps_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "owner" | "admin" | "editor" | "analyst" | "viewer"
      audit_status: "queued" | "running" | "completed" | "failed"
      integration_provider:
        | "wordpress"
        | "gsc"
        | "ga4"
        | "openai"
        | "lovable_ai"
      site_status: "connected" | "disconnected" | "error" | "pending"
      task_priority: "low" | "medium" | "high" | "urgent"
      task_status:
        | "todo"
        | "in_progress"
        | "review"
        | "approved"
        | "published"
        | "archived"
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
    Enums: {
      app_role: ["owner", "admin", "editor", "analyst", "viewer"],
      audit_status: ["queued", "running", "completed", "failed"],
      integration_provider: ["wordpress", "gsc", "ga4", "openai", "lovable_ai"],
      site_status: ["connected", "disconnected", "error", "pending"],
      task_priority: ["low", "medium", "high", "urgent"],
      task_status: [
        "todo",
        "in_progress",
        "review",
        "approved",
        "published",
        "archived",
      ],
    },
  },
} as const
