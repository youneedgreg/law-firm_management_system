"use client";

import { useId } from "react";

/**
 * Form primitives. Every control the screens use is built here once, on the
 * Broadsheet `.field` / `.input` / `.seg` classes, so a select on the billing
 * screen and a select in the topbar are the same object.
 *
 * They are client components only because they mint their own ids with
 * `useId`; none of them hold state — the values live on the form, and the
 * screens read them out of `FormData` on submit.
 */

export type Option = string | { value: string; label: string };

function optionValue(option: Option): string {
  return typeof option === "string" ? option : option.value;
}

function optionLabel(option: Option): string {
  return typeof option === "string" ? option : option.label;
}

/**
 * Optional props are written `?: T | undefined` rather than `?: T` throughout
 * this file. Under `exactOptionalPropertyTypes` those mean different things:
 * the short form forbids passing an explicit `undefined`, which is exactly what
 * forwarding an optional prop down does.
 */
interface FieldProps {
  label: string;
  /** Guidance under the control, e.g. how a value will be used. */
  hint?: string | undefined;
  /** Spans both columns of a `.form-grid`. */
  wide?: boolean | undefined;
}

/** Label, control and hint — the shell every field shares. */
export function Field({
  label,
  hint,
  wide,
  htmlFor,
  children,
}: FieldProps & { htmlFor: string; children: React.ReactNode }) {
  return (
    <div className={wide ? "field field-wide" : "field"}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

/** A fieldset for grouped controls — segmented buttons, checkbox rows. */
export function FieldGroup({
  label,
  hint,
  wide,
  children,
}: FieldProps & { children: React.ReactNode }) {
  return (
    <fieldset
      className={wide ? "field field-set field-wide" : "field field-set"}
    >
      <legend className="field-legend">{label}</legend>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </fieldset>
  );
}

export function FormGrid({ children }: { children: React.ReactNode }) {
  return <div className="form-grid">{children}</div>;
}

export function FormActions({ children }: { children: React.ReactNode }) {
  return <div className="form-actions">{children}</div>;
}

export function TextField({
  label,
  hint,
  wide,
  ...input
}: FieldProps & React.ComponentProps<"input">) {
  const generatedId = useId();
  const id = input.id ?? generatedId;
  return (
    <Field label={label} hint={hint} wide={wide} htmlFor={id}>
      <input {...input} id={id} className="input" />
    </Field>
  );
}

export function TextAreaField({
  label,
  hint,
  wide,
  ...textarea
}: FieldProps & React.ComponentProps<"textarea">) {
  const generatedId = useId();
  const id = textarea.id ?? generatedId;
  return (
    <Field label={label} hint={hint} wide={wide} htmlFor={id}>
      <textarea {...textarea} id={id} className="input" />
    </Field>
  );
}

/**
 * The dropdown. The wrapper carries the caret, so the control keeps the same
 * fill, border and focus ring as a text input.
 */
export function SelectControl({
  options,
  placeholder,
  className,
  ...select
}: {
  options: readonly Option[];
  /** Leading empty option, e.g. "Select a case". */
  placeholder?: string | undefined;
} & React.ComponentProps<"select">) {
  return (
    <span className={className ? `select ${className}` : "select"}>
      <select {...select} className="input">
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={optionValue(option)} value={optionValue(option)}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
    </span>
  );
}

export function SelectField({
  label,
  hint,
  wide,
  options,
  placeholder,
  ...select
}: FieldProps & {
  options: readonly Option[];
  placeholder?: string | undefined;
} & React.ComponentProps<"select">) {
  const generatedId = useId();
  const id = select.id ?? generatedId;
  return (
    <Field label={label} hint={hint} wide={wide} htmlFor={id}>
      <SelectControl
        {...select}
        id={id}
        options={options}
        placeholder={placeholder}
      />
    </Field>
  );
}

export function Checkbox({
  label,
  ...input
}: { label: string } & React.ComponentProps<"input">) {
  return (
    <label className="check">
      <input type="checkbox" {...input} />
      <span className="box" aria-hidden />
      {label}
    </label>
  );
}

/** A row of checkboxes sharing one name, e.g. notification channels. */
export function CheckboxGroup({
  label,
  hint,
  wide,
  name,
  options,
  checked = [],
}: FieldProps & {
  name: string;
  options: readonly Option[];
  /** Values ticked to begin with. */
  checked?: readonly string[];
}) {
  return (
    <FieldGroup label={label} hint={hint} wide={wide}>
      <div className="check-row">
        {options.map((option) => (
          <Checkbox
            key={optionValue(option)}
            name={name}
            value={optionValue(option)}
            label={optionLabel(option)}
            defaultChecked={checked.includes(optionValue(option))}
          />
        ))}
      </div>
    </FieldGroup>
  );
}

/** Two or three mutually exclusive choices, shown as one joined control. */
export function SegmentedField({
  label,
  hint,
  wide,
  name,
  options,
  defaultValue,
}: FieldProps & {
  name: string;
  options: readonly Option[];
  defaultValue?: string;
}) {
  return (
    <FieldGroup label={label} hint={hint} wide={wide}>
      <div className="seg">
        {options.map((option) => (
          <label className="seg-opt" key={optionValue(option)}>
            <input
              type="radio"
              name={name}
              value={optionValue(option)}
              defaultChecked={optionValue(option) === defaultValue}
            />
            {optionLabel(option)}
          </label>
        ))}
      </div>
    </FieldGroup>
  );
}

/** A stack of radio buttons, for choices that need room to be read. */
export function RadioField({
  label,
  hint,
  wide,
  name,
  options,
  defaultValue,
}: FieldProps & {
  name: string;
  options: readonly Option[];
  defaultValue?: string;
}) {
  return (
    <FieldGroup label={label} hint={hint} wide={wide}>
      <div className="check-row">
        {options.map((option) => (
          <label className="radio" key={optionValue(option)}>
            <input
              type="radio"
              name={name}
              value={optionValue(option)}
              defaultChecked={optionValue(option) === defaultValue}
            />
            <span className="dot" aria-hidden />
            {optionLabel(option)}
          </label>
        ))}
      </div>
    </FieldGroup>
  );
}
