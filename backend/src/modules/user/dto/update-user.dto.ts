import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * What you can change about yourself. Not the email: a new address would have
 * to be verified first, or anyone holding a session could point the account
 * at their own inbox and take it over through "forgot password".
 */
export class UpdateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

/** Deleting the account asks for the password again: a stolen session alone can't do it. */
export class DeleteAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password: string;
}
