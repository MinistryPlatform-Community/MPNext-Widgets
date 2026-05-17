import { describe, it, expect } from 'vitest';
import { ProfileUpdateSchema, ChangePasswordSchema } from './profile';

/**
 * Tests for profile.ts Zod schemas:
 *  - ProfileUpdateSchema (all fields optional, with min/email constraints)
 *  - ChangePasswordSchema (refinement: newPassword must match confirmPassword)
 *
 * Note: this file also exports several TypeScript interfaces (ProfileData,
 * ProfileLookups, etc.) -- those have no runtime schema and are not tested here.
 */

describe('ProfileUpdateSchema', () => {
  describe('happy path', () => {
    it('accepts a fully populated update', () => {
      const result = ProfileUpdateSchema.safeParse({
        Prefix_ID: 1,
        First_Name: 'Jane',
        Middle_Name: 'A.',
        Last_Name: 'Doe',
        Nickname: 'Janie',
        Suffix_ID: 2,
        Gender_ID: 1,
        Date_of_Birth: '1990-01-01',
        Marital_Status_ID: 3,
        Mobile_Phone: '555-1234',
        Company_Phone: '555-5678',
        Email_Address: 'jane@example.com',
        Do_Not_Text: false,
        Bulk_Email_Opt_Out: false,
      });
      expect(result.success).toBe(true);
    });

    it('accepts an empty object (all fields are optional)', () => {
      const result = ProfileUpdateSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts null for nullable-optional fields', () => {
      const result = ProfileUpdateSchema.safeParse({
        Prefix_ID: null,
        Middle_Name: null,
        Nickname: null,
        Suffix_ID: null,
        Gender_ID: null,
        Date_of_Birth: null,
        Marital_Status_ID: null,
        Mobile_Phone: null,
        Company_Phone: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('constraints', () => {
    it('rejects empty First_Name (min(1))', () => {
      const result = ProfileUpdateSchema.safeParse({ First_Name: '' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['First_Name']);
        expect(result.error.issues[0].message).toBe('First name is required');
      }
    });

    it('rejects empty Last_Name (min(1))', () => {
      const result = ProfileUpdateSchema.safeParse({ Last_Name: '' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['Last_Name']);
        expect(result.error.issues[0].message).toBe('Last name is required');
      }
    });

    it('rejects a malformed email', () => {
      const result = ProfileUpdateSchema.safeParse({ Email_Address: 'not-an-email' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['Email_Address']);
        expect(result.error.issues[0].message).toBe('Invalid email address');
      }
    });

    it('accepts a well-formed email', () => {
      const result = ProfileUpdateSchema.safeParse({ Email_Address: 'foo@bar.com' });
      expect(result.success).toBe(true);
    });
  });

  describe('type validation', () => {
    it('rejects string for Prefix_ID', () => {
      const result = ProfileUpdateSchema.safeParse({ Prefix_ID: 'one' });
      expect(result.success).toBe(false);
    });

    it('rejects number for First_Name', () => {
      const result = ProfileUpdateSchema.safeParse({ First_Name: 42 });
      expect(result.success).toBe(false);
    });

    it('rejects string for Do_Not_Text', () => {
      const result = ProfileUpdateSchema.safeParse({ Do_Not_Text: 'no' });
      expect(result.success).toBe(false);
    });

    it('rejects number for Bulk_Email_Opt_Out', () => {
      const result = ProfileUpdateSchema.safeParse({ Bulk_Email_Opt_Out: 0 });
      expect(result.success).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('accepts very long names', () => {
      const result = ProfileUpdateSchema.safeParse({
        First_Name: 'x'.repeat(1000),
        Last_Name: 'y'.repeat(1000),
      });
      expect(result.success).toBe(true);
    });

    it('accepts a single-character First_Name (meets min(1))', () => {
      const result = ProfileUpdateSchema.safeParse({ First_Name: 'A' });
      expect(result.success).toBe(true);
    });
  });
});

describe('ChangePasswordSchema', () => {
  describe('happy path', () => {
    it('accepts matching passwords meeting min length', () => {
      const result = ChangePasswordSchema.safeParse({
        oldPassword: 'oldpass',
        newPassword: 'newpassword123',
        confirmPassword: 'newpassword123',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('required fields', () => {
    it('fails when oldPassword is empty', () => {
      const result = ChangePasswordSchema.safeParse({
        oldPassword: '',
        newPassword: 'newpassword123',
        confirmPassword: 'newpassword123',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === 'oldPassword')).toBe(true);
      }
    });

    it('fails when oldPassword is missing', () => {
      const result = ChangePasswordSchema.safeParse({
        newPassword: 'newpassword123',
        confirmPassword: 'newpassword123',
      });
      expect(result.success).toBe(false);
    });

    it('fails when confirmPassword is empty', () => {
      const result = ChangePasswordSchema.safeParse({
        oldPassword: 'oldpass',
        newPassword: 'newpassword123',
        confirmPassword: '',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        // Both the min(1) and the .refine() may fire; ensure confirmPassword
        // path is present.
        expect(
          result.error.issues.some((i) => i.path[0] === 'confirmPassword'),
        ).toBe(true);
      }
    });
  });

  describe('constraints', () => {
    it('fails when newPassword is shorter than 8 chars', () => {
      const result = ChangePasswordSchema.safeParse({
        oldPassword: 'oldpass',
        newPassword: 'short',
        confirmPassword: 'short',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(
            (i) =>
              i.path[0] === 'newPassword' &&
              i.message === 'New password must be at least 8 characters',
          ),
        ).toBe(true);
      }
    });

    it('accepts a newPassword of exactly 8 chars', () => {
      const result = ChangePasswordSchema.safeParse({
        oldPassword: 'oldpass',
        newPassword: '12345678',
        confirmPassword: '12345678',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('refinement: passwords must match', () => {
    it('fails when newPassword !== confirmPassword', () => {
      const result = ChangePasswordSchema.safeParse({
        oldPassword: 'oldpass',
        newPassword: 'newpassword123',
        confirmPassword: 'differentpassword',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const mismatch = result.error.issues.find(
          (i) => i.message === 'Passwords do not match',
        );
        expect(mismatch).toBeDefined();
        expect(mismatch?.path).toEqual(['confirmPassword']);
      }
    });
  });

  describe('type validation', () => {
    it('rejects number for oldPassword', () => {
      const result = ChangePasswordSchema.safeParse({
        oldPassword: 12345,
        newPassword: 'newpassword123',
        confirmPassword: 'newpassword123',
      });
      expect(result.success).toBe(false);
    });

    it('rejects null for newPassword', () => {
      const result = ChangePasswordSchema.safeParse({
        oldPassword: 'oldpass',
        newPassword: null,
        confirmPassword: 'newpassword123',
      });
      expect(result.success).toBe(false);
    });
  });
});
