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
          organization_id: string
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
          organization_id: string
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
          organization_id?: string
          owner_id?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_org_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_visibility_tests: {
        Row: {
          appears: boolean | null
          citation_url: string | null
          engine: string
          id: string
          organization_id: string
          query: string
          rank: number | null
          raw_response: Json | null
          site_id: string
          tested_at: string
        }
        Insert: {
          appears?: boolean | null
          citation_url?: string | null
          engine: string
          id?: string
          organization_id: string
          query: string
          rank?: number | null
          raw_response?: Json | null
          site_id: string
          tested_at?: string
        }
        Update: {
          appears?: boolean | null
          citation_url?: string | null
          engine?: string
          id?: string
          organization_id?: string
          query?: string
          rank?: number | null
          raw_response?: Json | null
          site_id?: string
          tested_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_visibility_tests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_visibility_tests_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          brief_id: string | null
          created_at: string
          decided_at: string | null
          decision_note: string | null
          draft_payload: Json
          id: string
          organization_id: string
          requested_by: string
          reviewer_id: string | null
          site_id: string
          status: Database["public"]["Enums"]["approval_status"]
        }
        Insert: {
          brief_id?: string | null
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          draft_payload?: Json
          id?: string
          organization_id: string
          requested_by: string
          reviewer_id?: string | null
          site_id: string
          status?: Database["public"]["Enums"]["approval_status"]
        }
        Update: {
          brief_id?: string | null
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          draft_payload?: Json
          id?: string
          organization_id?: string
          requested_by?: string
          reviewer_id?: string | null
          site_id?: string
          status?: Database["public"]["Enums"]["approval_status"]
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "content_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json | null
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
          resource_id?: string | null
          resource_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_org_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      background_jobs: {
        Row: {
          created_at: string
          created_by: string
          error: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          items_processed: number
          job_type: string
          organization_id: string
          payload: Json
          result: Json | null
          site_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          total_items: number | null
        }
        Insert: {
          created_at?: string
          created_by: string
          error?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          items_processed?: number
          job_type: string
          organization_id: string
          payload?: Json
          result?: Json | null
          site_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          total_items?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string
          error?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          items_processed?: number
          job_type?: string
          organization_id?: string
          payload?: Json
          result?: Json | null
          site_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          total_items?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "background_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "background_jobs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      content_audits: {
        Row: {
          aeo_score: number | null
          ai_summary: string | null
          created_at: string
          eeat_score: number | null
          id: string
          organization_id: string
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
          organization_id: string
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
          organization_id?: string
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
            foreignKeyName: "content_audits_org_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
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
          organization_id: string
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
          organization_id: string
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
          organization_id?: string
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
            foreignKeyName: "content_briefs_org_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_briefs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      content_recommendations: {
        Row: {
          audit_id: string | null
          category: string
          created_at: string
          detail: string | null
          id: string
          organization_id: string
          post_id: string | null
          severity: string
          site_id: string
          status: string
          suggested_action: string | null
          title: string
        }
        Insert: {
          audit_id?: string | null
          category: string
          created_at?: string
          detail?: string | null
          id?: string
          organization_id: string
          post_id?: string | null
          severity?: string
          site_id: string
          status?: string
          suggested_action?: string | null
          title: string
        }
        Update: {
          audit_id?: string | null
          category?: string
          created_at?: string
          detail?: string | null
          id?: string
          organization_id?: string
          post_id?: string | null
          severity?: string
          site_id?: string
          status?: string
          suggested_action?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_recommendations_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "content_audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_recommendations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_recommendations_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "wordpress_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_recommendations_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      content_scores: {
        Row: {
          aeo_score: number | null
          audit_id: string | null
          computed_at: string
          eeat_score: number | null
          geo_score: number | null
          helpfulness_score: number | null
          id: string
          organization_id: string
          originality_score: number | null
          post_id: string | null
          quality_score: number | null
          site_id: string
        }
        Insert: {
          aeo_score?: number | null
          audit_id?: string | null
          computed_at?: string
          eeat_score?: number | null
          geo_score?: number | null
          helpfulness_score?: number | null
          id?: string
          organization_id: string
          originality_score?: number | null
          post_id?: string | null
          quality_score?: number | null
          site_id: string
        }
        Update: {
          aeo_score?: number | null
          audit_id?: string | null
          computed_at?: string
          eeat_score?: number | null
          geo_score?: number | null
          helpfulness_score?: number | null
          id?: string
          organization_id?: string
          originality_score?: number | null
          post_id?: string | null
          quality_score?: number | null
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_scores_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "content_audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_scores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_scores_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "wordpress_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_scores_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      ga4_daily: {
        Row: {
          conversions: number
          created_at: string
          date: string
          engaged_sessions: number
          id: string
          medium: string | null
          organization_id: string
          page_path: string | null
          revenue: number
          sessions: number
          site_id: string
          source: string | null
          users: number
        }
        Insert: {
          conversions?: number
          created_at?: string
          date: string
          engaged_sessions?: number
          id?: string
          medium?: string | null
          organization_id: string
          page_path?: string | null
          revenue?: number
          sessions?: number
          site_id: string
          source?: string | null
          users?: number
        }
        Update: {
          conversions?: number
          created_at?: string
          date?: string
          engaged_sessions?: number
          id?: string
          medium?: string | null
          organization_id?: string
          page_path?: string | null
          revenue?: number
          sessions?: number
          site_id?: string
          source?: string | null
          users?: number
        }
        Relationships: []
      }
      integration_connections: {
        Row: {
          config: Json
          created_at: string
          created_by: string
          credential_secret_name: string | null
          id: string
          last_error: string | null
          last_synced_at: string | null
          organization_id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          site_id: string | null
          status: Database["public"]["Enums"]["connection_status"]
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by: string
          credential_secret_name?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          organization_id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          site_id?: string | null
          status?: Database["public"]["Enums"]["connection_status"]
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string
          credential_secret_name?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          organization_id?: string
          provider?: Database["public"]["Enums"]["integration_provider"]
          site_id?: string | null
          status?: Database["public"]["Enums"]["connection_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_connections_site_id_fkey"
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
          organization_id: string
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
          organization_id: string
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
          organization_id?: string
          owner_id?: string
          provider?: Database["public"]["Enums"]["integration_provider"]
          site_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_org_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integrations_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_link_opportunities: {
        Row: {
          anchor_suggestion: string | null
          context_snippet: string | null
          created_at: string
          id: string
          organization_id: string
          relevance_score: number | null
          site_id: string
          source_post_id: string | null
          status: string
          target_post_id: string | null
        }
        Insert: {
          anchor_suggestion?: string | null
          context_snippet?: string | null
          created_at?: string
          id?: string
          organization_id: string
          relevance_score?: number | null
          site_id: string
          source_post_id?: string | null
          status?: string
          target_post_id?: string | null
        }
        Update: {
          anchor_suggestion?: string | null
          context_snippet?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          relevance_score?: number | null
          site_id?: string
          source_post_id?: string | null
          status?: string
          target_post_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "internal_link_opportunities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_link_opportunities_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_link_opportunities_source_post_id_fkey"
            columns: ["source_post_id"]
            isOneToOne: false
            referencedRelation: "wordpress_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_link_opportunities_target_post_id_fkey"
            columns: ["target_post_id"]
            isOneToOne: false
            referencedRelation: "wordpress_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      keyword_rankings: {
        Row: {
          created_at: string
          date: string
          difficulty: number | null
          id: string
          intent: string | null
          keyword: string
          keyword_id: string | null
          organization_id: string
          page: string | null
          position: number | null
          search_volume: number | null
          site_id: string
          source: string | null
        }
        Insert: {
          created_at?: string
          date: string
          difficulty?: number | null
          id?: string
          intent?: string | null
          keyword: string
          keyword_id?: string | null
          organization_id: string
          page?: string | null
          position?: number | null
          search_volume?: number | null
          site_id: string
          source?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          difficulty?: number | null
          id?: string
          intent?: string | null
          keyword?: string
          keyword_id?: string | null
          organization_id?: string
          page?: string | null
          position?: number | null
          search_volume?: number | null
          site_id?: string
          source?: string | null
        }
        Relationships: []
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
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
      search_console_daily: {
        Row: {
          clicks: number
          country: string | null
          created_at: string
          ctr: number | null
          date: string
          device: string | null
          id: string
          impressions: number
          organization_id: string
          page: string | null
          position: number | null
          query: string | null
          site_id: string
        }
        Insert: {
          clicks?: number
          country?: string | null
          created_at?: string
          ctr?: number | null
          date: string
          device?: string | null
          id?: string
          impressions?: number
          organization_id: string
          page?: string | null
          position?: number | null
          query?: string | null
          site_id: string
        }
        Update: {
          clicks?: number
          country?: string | null
          created_at?: string
          ctr?: number | null
          date?: string
          device?: string | null
          id?: string
          impressions?: number
          organization_id?: string
          page?: string | null
          position?: number | null
          query?: string | null
          site_id?: string
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
          organization_id: string
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
          organization_id: string
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
          organization_id?: string
          owner_id?: string
          status?: Database["public"]["Enums"]["site_status"]
          topical_authority_score?: number | null
          total_posts?: number | null
          updated_at?: string
          url?: string
          wp_username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sites_org_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          organization_id: string
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
          organization_id: string
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
          organization_id?: string
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
            foreignKeyName: "tasks_org_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      topical_cluster_pages: {
        Row: {
          cluster_id: string
          coverage_status: string
          created_at: string
          id: string
          organization_id: string
          page_role: string | null
          position: number | null
          post_id: string | null
          site_id: string
          target_keyword: string | null
          title: string | null
          updated_at: string
          url: string
        }
        Insert: {
          cluster_id: string
          coverage_status?: string
          created_at?: string
          id?: string
          organization_id: string
          page_role?: string | null
          position?: number | null
          post_id?: string | null
          site_id: string
          target_keyword?: string | null
          title?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          cluster_id?: string
          coverage_status?: string
          created_at?: string
          id?: string
          organization_id?: string
          page_role?: string | null
          position?: number | null
          post_id?: string | null
          site_id?: string
          target_keyword?: string | null
          title?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "topical_cluster_pages_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "topical_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topical_cluster_pages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topical_cluster_pages_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "wordpress_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topical_cluster_pages_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      topical_clusters: {
        Row: {
          coverage_percent: number | null
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string
          pillar_topic: string | null
          site_id: string
        }
        Insert: {
          coverage_percent?: number | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
          pillar_topic?: string | null
          site_id: string
        }
        Update: {
          coverage_percent?: number | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          pillar_topic?: string | null
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topical_clusters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topical_clusters_site_id_fkey"
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
          organization_id: string
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
          organization_id: string
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
          organization_id?: string
          owner_id?: string
          parent_id?: string | null
          pillar?: string
          priority?: number | null
          site_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topical_maps_org_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
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
      wordpress_posts: {
        Row: {
          aeo_score: number | null
          author: string | null
          categories: Json | null
          content_html: string | null
          content_text: string | null
          created_at: string
          excerpt: string | null
          featured_image_url: string | null
          freshness_score: number | null
          geo_score: number | null
          id: string
          modified_at: string | null
          organization_id: string
          post_type: string
          published_at: string | null
          reading_time: number | null
          recommended_action: string | null
          seo_score: number | null
          site_id: string
          slug: string | null
          status: string | null
          synced_at: string
          tags: Json | null
          title: string | null
          url: string
          word_count: number | null
          wp_post_id: number
        }
        Insert: {
          aeo_score?: number | null
          author?: string | null
          categories?: Json | null
          content_html?: string | null
          content_text?: string | null
          created_at?: string
          excerpt?: string | null
          featured_image_url?: string | null
          freshness_score?: number | null
          geo_score?: number | null
          id?: string
          modified_at?: string | null
          organization_id: string
          post_type?: string
          published_at?: string | null
          reading_time?: number | null
          recommended_action?: string | null
          seo_score?: number | null
          site_id: string
          slug?: string | null
          status?: string | null
          synced_at?: string
          tags?: Json | null
          title?: string | null
          url: string
          word_count?: number | null
          wp_post_id: number
        }
        Update: {
          aeo_score?: number | null
          author?: string | null
          categories?: Json | null
          content_html?: string | null
          content_text?: string | null
          created_at?: string
          excerpt?: string | null
          featured_image_url?: string | null
          freshness_score?: number | null
          geo_score?: number | null
          id?: string
          modified_at?: string | null
          organization_id?: string
          post_type?: string
          published_at?: string | null
          reading_time?: number | null
          recommended_action?: string | null
          seo_score?: number | null
          site_id?: string
          slug?: string | null
          status?: string | null
          synced_at?: string
          tags?: Json | null
          title?: string | null
          url?: string
          word_count?: number | null
          wp_post_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "wordpress_posts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wordpress_posts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_create_initial_org_membership: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      has_org_role: {
        Args: {
          _org_id: string
          _role: Database["public"]["Enums"]["org_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_org_admin: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_member: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      org_has_no_members: { Args: { _org_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "owner" | "admin" | "editor" | "analyst" | "viewer"
      approval_status: "pending" | "approved" | "rejected" | "cancelled"
      audit_status: "queued" | "running" | "completed" | "failed"
      connection_status: "pending" | "connected" | "error" | "revoked"
      integration_provider:
        | "wordpress"
        | "gsc"
        | "ga4"
        | "openai"
        | "lovable_ai"
      job_status:
        | "queued"
        | "running"
        | "succeeded"
        | "failed"
        | "cancelled"
        | "completed"
      org_role: "owner" | "admin" | "editor" | "analyst" | "viewer"
      site_status:
        | "connected"
        | "disconnected"
        | "error"
        | "pending"
        | "verifying"
        | "sync_running"
        | "sync_failed"
        | "stale"
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
      approval_status: ["pending", "approved", "rejected", "cancelled"],
      audit_status: ["queued", "running", "completed", "failed"],
      connection_status: ["pending", "connected", "error", "revoked"],
      integration_provider: ["wordpress", "gsc", "ga4", "openai", "lovable_ai"],
      job_status: [
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled",
        "completed",
      ],
      org_role: ["owner", "admin", "editor", "analyst", "viewer"],
      site_status: [
        "connected",
        "disconnected",
        "error",
        "pending",
        "verifying",
        "sync_running",
        "sync_failed",
        "stale",
      ],
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
