import {
	ApplicationCommandOptionType,
	type APIApplicationCommandBasicOption,
	type APIApplicationCommandOption,
	type APIApplicationCommandStringOption
} from 'discord-api-types/v10';
import {
	hasChoicesAndAutocompleteSupport,
	hasMinMaxLengthSupport,
	hasMinMaxValueSupport,
	optionTypeToPrettyName,
	subcommandTypes,
	type APIApplicationCommandChoosableAndAutocompletableTypes,
	type APIApplicationCommandNumericTypes,
	type APIApplicationCommandSubcommandTypes,
	type CommandDifference
} from './_shared';
import { checkDescription } from './description';
import { checkLocalizations } from './localizations';
import { checkName } from './name';
import { handleAutocomplete } from './option/autocomplete';
import { handleMinMaxLengthOptions } from './option/minMaxLength';
import { handleMinMaxValueOptions } from './option/minMaxValue';
import { checkOptionRequired } from './option/required';
import { checkOptionType } from './option/type';

export function* reportOptionDifferences({
	option,
	existingOption,
	currentIndex,
	keyPath = (index: number) => `options[${index}]`
}: {
	option: APIApplicationCommandOption;
	currentIndex: number;
	existingOption?: APIApplicationCommandOption;
	keyPath?: (index: number) => string;
}): Generator<CommandDifference> {
	// If current option doesn't exist, report and return
	if (!existingOption) {
		const expectedType = optionTypeToPrettyName.get(option.type) ?? `unknown (${option.type}); please contact Sapphire developers about this!`;

		yield {
			key: keyPath(currentIndex),
			expected: `${expectedType} with name ${option.name}`,
			original: 'no option present'
		};

		return;
	}

	// Check type
	yield* checkOptionType({
		key: `${keyPath(currentIndex)}.type`,
		originalType: existingOption.type,
		expectedType: option.type
	});

	// Check name
	yield* checkName({
		key: `${keyPath(currentIndex)}.name`,
		oldName: existingOption.name,
		newName: option.name
	});

	// Check localized names
	const originalLocalizedNames = existingOption.name_localizations;
	const expectedLocalizedNames = option.name_localizations;

	yield* checkLocalizations({
		localeMapName: `${keyPath(currentIndex)}.nameLocalizations`,
		localePresentMessage: 'localized names',
		localeMissingMessage: 'no localized names',
		originalLocalizedDescriptions: originalLocalizedNames,
		expectedLocalizedDescriptions: expectedLocalizedNames
	});

	// Check description
	yield* checkDescription({
		key: `${keyPath(currentIndex)}.description`,
		oldDescription: existingOption.description,
		newDescription: option.description
	});

	// Check localized descriptions
	const originalLocalizedDescriptions = existingOption.description_localizations;
	const expectedLocalizedDescriptions = option.description_localizations;

	yield* checkLocalizations({
		localeMapName: `${keyPath(currentIndex)}.descriptionLocalizations`,
		localePresentMessage: 'localized descriptions',
		localeMissingMessage: 'no localized descriptions',
		originalLocalizedDescriptions,
		expectedLocalizedDescriptions
	});

	// Check required
	yield* checkOptionRequired({
		key: `${keyPath(currentIndex)}.required`,
		oldRequired: existingOption.required,
		newRequired: option.required
	});

	// Check for subcommands
	if (subcommandTypes.includes(existingOption.type) && subcommandTypes.includes(option.type)) {
		const castedExisting = existingOption as APIApplicationCommandSubcommandTypes;
		const castedExpected = option as APIApplicationCommandSubcommandTypes;

		if (
			castedExisting.type === ApplicationCommandOptionType.SubcommandGroup &&
			castedExpected.type === ApplicationCommandOptionType.SubcommandGroup
		) {
			// We know we have options in this case, because they are both groups
			for (const [subcommandIndex, subcommandOption] of castedExpected.options!.entries()) {
				yield* reportOptionDifferences({
					currentIndex: subcommandIndex,
					option: subcommandOption,
					existingOption: castedExisting.options?.[subcommandIndex],
					keyPath: (index) => `${keyPath(currentIndex)}.options[${index}]`
				});
			}
		} else if (
			castedExisting.type === ApplicationCommandOptionType.Subcommand &&
			castedExpected.type === ApplicationCommandOptionType.Subcommand
		) {
			yield* handleSubcommandOptions({
				expectedOptions: castedExpected.options,
				existingOptions: castedExisting.options,
				currentIndex,
				keyPath
			});
		}
	}

	if (hasMinMaxValueSupport(option)) {
		// Check min and max_value
		const existingCasted = existingOption as APIApplicationCommandNumericTypes;

		yield* handleMinMaxValueOptions({
			currentIndex,
			existingOption: existingCasted,
			expectedOption: option,
			keyPath
		});
	}

	if (hasChoicesAndAutocompleteSupport(option)) {
		const existingCasted = existingOption as APIApplicationCommandChoosableAndAutocompletableTypes;

		yield* handleAutocomplete({
			expectedOption: option,
			existingOption: existingCasted,
			currentIndex,
			keyPath
		});
	}

	if (hasMinMaxLengthSupport(option)) {
		// Check min and max_value
		const existingCasted = existingOption as APIApplicationCommandStringOption;

		yield* handleMinMaxLengthOptions({
			currentIndex,
			existingOption: existingCasted,
			expectedOption: option,
			keyPath
		});
	}
}

function* handleSubcommandOptions({
	expectedOptions,
	existingOptions,
	currentIndex,
	keyPath
}: {
	expectedOptions?: APIApplicationCommandBasicOption[];
	existingOptions?: APIApplicationCommandBasicOption[];
	currentIndex: number;
	keyPath: (index: number) => string;
}): Generator<CommandDifference> {
	// 0. No existing options and now we have options
	if (!existingOptions?.length && expectedOptions?.length) {
		yield {
			key: `${keyPath(currentIndex)}.options`,
			expected: 'options present',
			original: 'no options present'
		};
	}

	// 1. Existing options and now we have no options
	else if (existingOptions?.length && !expectedOptions?.length) {
		yield {
			key: `${keyPath(currentIndex)}.options`,
			expected: 'no options present',
			original: 'options present'
		};
	}

	// 2. Iterate over each option if we have any and see what's different
	else if (expectedOptions?.length) {
		let processedIndex = 0;
		for (const subcommandOption of expectedOptions) {
			const currentSubCommandOptionIndex = processedIndex++;
			const existingSubcommandOption = existingOptions![currentSubCommandOptionIndex];

			yield* reportOptionDifferences({
				currentIndex: currentSubCommandOptionIndex,
				option: subcommandOption,
				existingOption: existingSubcommandOption,
				keyPath: (index) => `${keyPath(currentIndex)}.options[${index}]`
			});
		}

		// If we went through less options than we previously had, report that
		if (processedIndex < existingOptions!.length) {
			let option: APIApplicationCommandOption;
			while ((option = existingOptions![processedIndex]) !== undefined) {
				const expectedType =
					optionTypeToPrettyName.get(option.type) ?? `unknown (${option.type}); please contact Sapphire developers about this!`;

				yield {
					key: `existing command option at path ${keyPath(currentIndex)}.options[${processedIndex}]`,
					expected: 'no option present',
					original: `${expectedType} with name ${option.name}`
				};

				processedIndex++;
			}
		}
	}
}
